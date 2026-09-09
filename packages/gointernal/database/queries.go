package database

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

// Window aggregates over a trailing period.
type Window struct {
	VolumeUSD *big.Rat
	TxCount   int64
	// Unpriced swaps are reported rather than hidden: a volume figure computed
	// from half the trades should not look authoritative.
	Unpriced int64
}

func ratFrom(s *string) *big.Rat {
	if s == nil || *s == "" {
		return nil
	}
	r, ok := new(big.Rat).SetString(*s)
	if !ok {
		return nil
	}
	return r
}

// VolumeSince aggregates swaps newer than `since`, optionally for one pair.
func (s *Store) VolumeSince(ctx context.Context, since time.Time, pair *string) (Window, error) {
	var vol *string
	var w Window
	err := s.pool.QueryRow(ctx, `
		SELECT sum(amount_usd)::text,
		       count(*),
		       count(*) FILTER (WHERE amount_usd IS NULL)
		  FROM swaps
		 WHERE timestamp >= $1
		   AND ($2::text IS NULL OR pair_address = $2)`,
		since.Unix(), pair,
	).Scan(&vol, &w.TxCount, &w.Unpriced)
	if err != nil {
		return w, fmt.Errorf("database: volume window: %w", err)
	}
	w.VolumeUSD = ratFrom(vol)
	if w.VolumeUSD == nil {
		w.VolumeUSD = new(big.Rat)
	}
	return w, nil
}

// SwapRow is a swap joined with the symbols needed to render it.
type SwapRow struct {
	models.Swap
	TokenInSymbol  *string
	TokenOutSymbol *string
}

// SwapsPage returns swaps newest-first, filtered by pair or by account.
//
// Parameterised throughout — llm.txt s45 forbids concatenating an address or a
// pagination value into SQL, and an address arriving from a URL is exactly the
// input that must never reach the planner as text.
func (s *Store) SwapsPage(ctx context.Context, pair, account *string, limit, offset int) ([]SwapRow, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM swaps
		 WHERE ($1::text IS NULL OR pair_address = $1)
		   AND ($2::text IS NULL OR sender = $2 OR recipient = $2)`,
		pair, account,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("database: counting swaps: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT s.tx_hash, s.log_index, s.block_number, s.timestamp, s.pair_address,
		       s.sender, s.recipient, s.token_in_address, s.token_out_address,
		       s.amount_in::text, s.amount_out::text, s.amount_usd::text,
		       ti.symbol, tout.symbol
		  FROM swaps s
		  LEFT JOIN tokens ti   ON ti.address   = s.token_in_address
		  LEFT JOIN tokens tout ON tout.address = s.token_out_address
		 WHERE ($1::text IS NULL OR s.pair_address = $1)
		   AND ($2::text IS NULL OR s.sender = $2 OR s.recipient = $2)
		 ORDER BY s.block_number DESC, s.log_index DESC
		 LIMIT $3 OFFSET $4`,
		pair, account, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("database: listing swaps: %w", err)
	}
	defer rows.Close()

	var out []SwapRow
	for rows.Next() {
		var r SwapRow
		var in, outAmt, usd *string
		if err := rows.Scan(&r.TxHash, &r.LogIndex, &r.BlockNumber, &r.Timestamp, &r.PairAddress,
			&r.Sender, &r.Recipient, &r.TokenInAddress, &r.TokenOutAddress,
			&in, &outAmt, &usd, &r.TokenInSymbol, &r.TokenOutSymbol); err != nil {
			return nil, 0, err
		}
		if in != nil {
			if v, err := models.ParseBigInt(*in); err == nil {
				r.AmountIn = v
			}
		}
		if outAmt != nil {
			if v, err := models.ParseBigInt(*outAmt); err == nil {
				r.AmountOut = v
			}
		}
		r.AmountUSD = ratFrom(usd)
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// LiquidityPage returns mint/burn history for a pair.
func (s *Store) LiquidityPage(ctx context.Context, pair string, limit, offset int) ([]models.LiquidityEvent, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM liquidity_events WHERE pair_address = $1`, pair,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("database: counting liquidity events: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT tx_hash, log_index, block_number, timestamp, pair_address, event_type,
		       sender, recipient, amount0::text, amount1::text, amount_usd::text
		  FROM liquidity_events
		 WHERE pair_address = $1
		 ORDER BY block_number DESC, log_index DESC
		 LIMIT $2 OFFSET $3`, pair, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("database: listing liquidity events: %w", err)
	}
	defer rows.Close()

	var out []models.LiquidityEvent
	for rows.Next() {
		var e models.LiquidityEvent
		var typ, a0, a1 string
		var usd *string
		if err := rows.Scan(&e.TxHash, &e.LogIndex, &e.BlockNumber, &e.Timestamp,
			&e.PairAddress, &typ, &e.Sender, &e.Recipient, &a0, &a1, &usd); err != nil {
			return nil, 0, err
		}
		e.EventType = models.LiquidityEventType(typ)
		e.Amount0, _ = models.ParseBigInt(a0)
		e.Amount1, _ = models.ParseBigInt(a1)
		e.AmountUSD = ratFrom(usd)
		out = append(out, e)
	}
	return out, total, rows.Err()
}

// ChartPoint is one time bucket of activity for a pair.
//
// Prices and TVL are the bucket's close, taken from the last Sync in it. They
// stay nil for a pool with no route to a stablecoin, and for buckets indexed
// before snapshots were recorded — a gap in the series is honest, a
// back-filled guess is not.
type ChartPoint struct {
	Bucket         int64
	VolumeUSD      *big.Rat
	TxCount        int64
	Token0PriceUSD *big.Rat
	Token1PriceUSD *big.Rat
	TVLUSD         *big.Rat
}

// ChartBuckets aggregates a pair's activity into fixed time buckets.
//
// Volume and transaction counts come from the swaps table, which is the durable
// record: a chart rebuilt after a database wipe matches the one before it.
// Prices and TVL come from pair_snapshots, written by the indexer at the close
// of each bucket from the reserves as they stood then.
//
// The join is a full outer join because the two sides do not always coincide: a
// bucket where liquidity was added but nothing traded has a snapshot and no
// swaps, and a bucket indexed before snapshots existed has swaps and no
// snapshot. Either way the bucket appears, with the missing half null.
func (s *Store) ChartBuckets(ctx context.Context, pair string, bucketSeconds int64, since time.Time) ([]ChartPoint, error) {
	rows, err := s.pool.Query(ctx, `
		WITH vol AS (
			SELECT (timestamp / $2) * $2 AS bucket,
			       sum(amount_usd) AS volume_usd,
			       count(*)        AS tx_count
			  FROM swaps
			 WHERE pair_address = $1 AND timestamp >= $3
			 GROUP BY bucket
		), snap AS (
			SELECT timestamp_bucket AS bucket,
			       token0_price_usd, token1_price_usd, tvl_usd
			  FROM pair_snapshots
			 WHERE pair_address = $1 AND bucket_seconds = $2 AND timestamp_bucket >= $3
		)
		SELECT COALESCE(v.bucket, s.bucket) AS bucket,
		       v.volume_usd::text,
		       COALESCE(v.tx_count, 0),
		       s.token0_price_usd::text,
		       s.token1_price_usd::text,
		       s.tvl_usd::text
		  FROM vol v FULL OUTER JOIN snap s ON v.bucket = s.bucket
		 ORDER BY bucket`, pair, bucketSeconds, since.Unix())
	if err != nil {
		return nil, fmt.Errorf("database: chart buckets: %w", err)
	}
	defer rows.Close()

	var out []ChartPoint
	for rows.Next() {
		var p ChartPoint
		var usd, price0, price1, tvl *string
		if err := rows.Scan(&p.Bucket, &usd, &p.TxCount, &price0, &price1, &tvl); err != nil {
			return nil, err
		}
		// A bucket with no swaps traded nothing, so zero volume is a fact rather
		// than a missing value. Prices and TVL stay nil when unknown.
		p.VolumeUSD = ratFrom(usd)
		if p.VolumeUSD == nil {
			p.VolumeUSD = new(big.Rat)
		}
		p.Token0PriceUSD, p.Token1PriceUSD, p.TVLUSD = ratFrom(price0), ratFrom(price1), ratFrom(tvl)
		out = append(out, p)
	}
	return out, rows.Err()
}

// Pair fetches one pair by address.
func (s *Store) Pair(ctx context.Context, address string) (*models.Pair, error) {
	var p models.Pair
	var r0, r1, ts string
	err := s.pool.QueryRow(ctx, `
		SELECT address, token0_address, token1_address,
		       reserve0::text, reserve1::text, total_supply::text,
		       created_block, created_tx_hash, created_log_index, created_timestamp, last_sync_block
		  FROM pairs WHERE address = $1`, address,
	).Scan(&p.Address, &p.Token0Address, &p.Token1Address, &r0, &r1, &ts,
		&p.CreatedBlock, &p.CreatedTxHash, &p.CreatedLogIndex, &p.CreatedTimestamp, &p.LastSyncBlock)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("database: reading pair: %w", err)
	}
	p.Reserve0, _ = models.ParseBigInt(r0)
	p.Reserve1, _ = models.ParseBigInt(r1)
	p.TotalSupply, _ = models.ParseBigInt(ts)
	return &p, nil
}

// Token fetches one token by address.
func (s *Store) Token(ctx context.Context, address string) (*models.Token, error) {
	var t models.Token
	err := s.pool.QueryRow(ctx, `
		SELECT address, symbol, name, decimals, metadata_complete, is_whitelisted, is_stable, is_wkash
		  FROM tokens WHERE address = $1`, address,
	).Scan(&t.Address, &t.Symbol, &t.Name, &t.Decimals,
		&t.MetadataComplete, &t.IsWhitelisted, &t.IsStable, &t.IsWKASH)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("database: reading token: %w", err)
	}
	return &t, nil
}
