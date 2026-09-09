// Package database is the PostgreSQL projection of ArkSwap chain history.
//
// PostgreSQL is never a source of truth (llm.txt s61). Every row here can be
// reconstructed by replaying events from the factory deployment block, and the
// rebuild path is exercised by the integration tests.
package database

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

// Migrations are embedded so `go run ./cmd/indexer` works against a bare
// database, which is what makes the "delete the database and rebuild from
// chain" property (llm.txt s51) something anyone can actually try.
//
//go:embed migrations/*.sql
var migrationFS embed.FS

type Store struct {
	pool *pgxpool.Pool
}

func Connect(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("database: connecting: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database: ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// Migrate applies every embedded up-migration in order.
//
// Tracked in schema_migrations so re-running is a no-op; each file runs inside
// its own transaction so a failure leaves the schema at the last good version
// rather than half-applied.
func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("database: creating schema_migrations: %w", err)
	}

	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("database: reading migrations: %w", err)
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".up.sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var exists bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, name,
		).Scan(&exists); err != nil {
			return fmt.Errorf("database: checking migration %s: %w", name, err)
		}
		if exists {
			continue
		}
		body, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("database: reading %s: %w", name, err)
		}
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("database: applying %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("database: recording %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("database: committing %s: %w", name, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------- block tx ---

// Tx is a single block's unit of work.
type Tx struct {
	tx pgx.Tx
}

// InBlockTx runs fn inside one transaction (llm.txt s40).
//
// The block row, its events, the pair state it updates and the advanced indexer
// cursor all commit together or not at all. Marking a block complete when only
// part of its data landed is the one failure that replay cannot repair, because
// the cursor would skip past the missing rows forever.
func (s *Store) InBlockTx(ctx context.Context, fn func(*Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("database: begin: %w", err)
	}
	if err := fn(&Tx{tx: tx}); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			return fmt.Errorf("%w (rollback also failed: %v)", err, rbErr)
		}
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("database: commit: %w", err)
	}
	return nil
}

func num(v *big.Int) string {
	if v == nil {
		return "0"
	}
	return v.String()
}

// numPtr renders a nullable USD value. nil stays NULL: "unknown" is not zero,
// and summing it as zero would understate volume rather than visibly fail.
func numPtr(v *big.Rat) *string {
	if v == nil {
		return nil
	}
	s := v.FloatString(models.USD_SCALE)
	return &s
}

// ------------------------------------------------------------- indexer state ---

// IndexerState returns the committed cursor, or (nil, nil) on a fresh database.
func (s *Store) IndexerState(ctx context.Context, chainID uint64) (*models.IndexerState, error) {
	var st models.IndexerState
	err := s.pool.QueryRow(ctx,
		`SELECT chain_id, last_processed_block, last_processed_block_hash
		   FROM indexer_state WHERE chain_id = $1`, chainID,
	).Scan(&st.ChainID, &st.LastProcessedBlock, &st.LastProcessedBlockHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("database: reading indexer state: %w", err)
	}
	return &st, nil
}

// SetIndexerState advances the cursor. Only ever called inside a block
// transaction, after that block's events are written.
func (t *Tx) SetIndexerState(ctx context.Context, st models.IndexerState) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO indexer_state (chain_id, last_processed_block, last_processed_block_hash, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (chain_id) DO UPDATE
		  SET last_processed_block = EXCLUDED.last_processed_block,
		      last_processed_block_hash = EXCLUDED.last_processed_block_hash,
		      updated_at = now()`,
		st.ChainID, st.LastProcessedBlock, st.LastProcessedBlockHash)
	if err != nil {
		return fmt.Errorf("database: writing indexer state: %w", err)
	}
	return nil
}

// ------------------------------------------------------------------- blocks ---

func (t *Tx) InsertBlock(ctx context.Context, b models.Block) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO blocks (number, hash, parent_hash, timestamp, processed_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (number) DO UPDATE
		  SET hash = EXCLUDED.hash,
		      parent_hash = EXCLUDED.parent_hash,
		      timestamp = EXCLUDED.timestamp,
		      processed_at = now()`,
		b.Number, b.Hash, b.ParentHash, b.Timestamp)
	if err != nil {
		return fmt.Errorf("database: inserting block %d: %w", b.Number, err)
	}
	return nil
}

// BlockHash returns a stored block's hash, for the parent-hash check.
func (s *Store) BlockHash(ctx context.Context, number uint64) (string, bool, error) {
	var h string
	err := s.pool.QueryRow(ctx, `SELECT hash FROM blocks WHERE number = $1`, number).Scan(&h)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("database: reading block %d: %w", number, err)
	}
	return h, true, nil
}

// ------------------------------------------------------------------- tokens ---

// UpsertToken records a token without overwriting good metadata with bad.
//
// A later read that reverts must not blank a symbol that was captured
// successfully earlier, so each field is only replaced when the incoming value
// is non-null. Curated flags are preserved entirely.
func (t *Tx) UpsertToken(ctx context.Context, tok models.Token) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO tokens (address, symbol, name, decimals, metadata_complete, is_stable, is_wkash)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (address) DO UPDATE
		  SET symbol            = COALESCE(EXCLUDED.symbol, tokens.symbol),
		      name              = COALESCE(EXCLUDED.name, tokens.name),
		      decimals          = COALESCE(EXCLUDED.decimals, tokens.decimals),
		      metadata_complete = tokens.metadata_complete OR EXCLUDED.metadata_complete,
		      is_stable         = tokens.is_stable OR EXCLUDED.is_stable,
		      is_wkash          = tokens.is_wkash OR EXCLUDED.is_wkash,
		      updated_at        = now()`,
		tok.Address, tok.Symbol, tok.Name, tok.Decimals, tok.MetadataComplete, tok.IsStable, tok.IsWKASH)
	if err != nil {
		return fmt.Errorf("database: upserting token %s: %w", tok.Address, err)
	}
	return nil
}

func (s *Store) Tokens(ctx context.Context) ([]models.Token, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT address, symbol, name, decimals, metadata_complete, is_whitelisted, is_stable, is_wkash
		  FROM tokens ORDER BY address`)
	if err != nil {
		return nil, fmt.Errorf("database: listing tokens: %w", err)
	}
	defer rows.Close()

	var out []models.Token
	for rows.Next() {
		var t models.Token
		if err := rows.Scan(&t.Address, &t.Symbol, &t.Name, &t.Decimals,
			&t.MetadataComplete, &t.IsWhitelisted, &t.IsStable, &t.IsWKASH); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// -------------------------------------------------------------------- pairs ---

func (t *Tx) UpsertPair(ctx context.Context, p models.Pair) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO pairs (address, token0_address, token1_address, reserve0, reserve1, total_supply,
		                   created_block, created_tx_hash, created_log_index, created_timestamp, updated_at)
		VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7, $8, $9, $10, now())
		ON CONFLICT (address) DO UPDATE SET updated_at = now()`,
		p.Address, p.Token0Address, p.Token1Address,
		num(p.Reserve0), num(p.Reserve1), num(p.TotalSupply),
		p.CreatedBlock, p.CreatedTxHash, p.CreatedLogIndex, p.CreatedTimestamp)
	if err != nil {
		return fmt.Errorf("database: upserting pair %s: %w", p.Address, err)
	}
	return nil
}

// SetPairReserves records reserves from a Sync event.
//
// Sync is authoritative (llm.txt s21): reserves are taken from it rather than
// reconstructed from swap arithmetic, which would drift on any donation, skim,
// or fee-on-transfer token.
//
// The block guard keeps an out-of-order write from moving reserves backwards.
func (t *Tx) SetPairReserves(ctx context.Context, pair string, r0, r1 *big.Int, block uint64) error {
	_, err := t.tx.Exec(ctx, `
		UPDATE pairs
		   SET reserve0 = $2::numeric, reserve1 = $3::numeric,
		       last_sync_block = $4, updated_at = now()
		 WHERE address = $1
		   AND (last_sync_block IS NULL OR last_sync_block <= $4)`,
		pair, num(r0), num(r1), block)
	if err != nil {
		return fmt.Errorf("database: setting reserves for %s: %w", pair, err)
	}
	return nil
}

// UpsertPairSnapshot records a pair's state at the close of a time bucket.
//
// Last write in the bucket wins, which gives close semantics: replaying the
// bucket's Sync events in order leaves the same row a fresh sync would, so a
// rebuilt database produces an identical series.
//
// Volume and transaction counts are deliberately not written here. They are
// aggregated from the swaps table at read time, which keeps one source of truth
// for volume and means a reorg that removes swaps corrects the chart without a
// second set of counters to unwind.
func (t *Tx) UpsertPairSnapshot(ctx context.Context, snap models.PairSnapshot) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO pair_snapshots (
			pair_address, bucket_seconds, timestamp_bucket,
			reserve0, reserve1, token0_price_usd, token1_price_usd, tvl_usd
		) VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric)
		ON CONFLICT (pair_address, bucket_seconds, timestamp_bucket) DO UPDATE
		   SET reserve0         = EXCLUDED.reserve0,
		       reserve1         = EXCLUDED.reserve1,
		       token0_price_usd = EXCLUDED.token0_price_usd,
		       token1_price_usd = EXCLUDED.token1_price_usd,
		       tvl_usd          = EXCLUDED.tvl_usd`,
		snap.PairAddress, snap.BucketSeconds, snap.TimestampBucket,
		num(snap.Reserve0), num(snap.Reserve1),
		numPtr(snap.Token0PriceUSD), numPtr(snap.Token1PriceUSD), numPtr(snap.TVLUSD))
	if err != nil {
		return fmt.Errorf("database: snapshotting %s: %w", snap.PairAddress, err)
	}
	return nil
}

func (t *Tx) SetPairTotalSupply(ctx context.Context, pair string, supply *big.Int) error {
	_, err := t.tx.Exec(ctx,
		`UPDATE pairs SET total_supply = $2::numeric, updated_at = now() WHERE address = $1`,
		pair, num(supply))
	return err
}

func (s *Store) Pairs(ctx context.Context) ([]models.Pair, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT address, token0_address, token1_address,
		       reserve0::text, reserve1::text, total_supply::text,
		       created_block, created_tx_hash, created_log_index, created_timestamp, last_sync_block
		  FROM pairs ORDER BY created_block, created_log_index`)
	if err != nil {
		return nil, fmt.Errorf("database: listing pairs: %w", err)
	}
	defer rows.Close()

	var out []models.Pair
	for rows.Next() {
		var p models.Pair
		var r0, r1, ts string
		if err := rows.Scan(&p.Address, &p.Token0Address, &p.Token1Address,
			&r0, &r1, &ts, &p.CreatedBlock, &p.CreatedTxHash, &p.CreatedLogIndex,
			&p.CreatedTimestamp, &p.LastSyncBlock); err != nil {
			return nil, err
		}
		if p.Reserve0, err = models.ParseBigInt(r0); err != nil {
			return nil, err
		}
		if p.Reserve1, err = models.ParseBigInt(r1); err != nil {
			return nil, err
		}
		if p.TotalSupply, err = models.ParseBigInt(ts); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) PairCount(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM pairs`).Scan(&n)
	return n, err
}

// -------------------------------------------------------------------- swaps ---

// InsertSwap is idempotent on (tx_hash, log_index) (llm.txt s12, s20).
//
// DO NOTHING rather than DO UPDATE: a log is immutable, so a second sighting of
// the same one carries no new information. Replaying a block must never
// double-count volume.
func (t *Tx) InsertSwap(ctx context.Context, s models.Swap) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO swaps (chain_id, tx_hash, log_index, block_number, block_hash, timestamp,
		                   pair_address, sender, recipient,
		                   amount0_in, amount1_in, amount0_out, amount1_out,
		                   token_in_address, token_out_address, amount_in, amount_out, amount_usd)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
		        $10::numeric,$11::numeric,$12::numeric,$13::numeric,
		        $14,$15,$16::numeric,$17::numeric,$18::numeric)
		ON CONFLICT (tx_hash, log_index) DO NOTHING`,
		s.ChainID, s.TxHash, s.LogIndex, s.BlockNumber, s.BlockHash, s.Timestamp,
		s.PairAddress, s.Sender, s.Recipient,
		num(s.Amount0In), num(s.Amount1In), num(s.Amount0Out), num(s.Amount1Out),
		s.TokenInAddress, s.TokenOutAddress,
		nullableNum(s.AmountIn), nullableNum(s.AmountOut), numPtr(s.AmountUSD))
	if err != nil {
		return fmt.Errorf("database: inserting swap %s/%d: %w", s.TxHash, s.LogIndex, err)
	}
	return nil
}

func nullableNum(v *big.Int) *string {
	if v == nil {
		return nil
	}
	s := v.String()
	return &s
}

func (t *Tx) InsertLiquidityEvent(ctx context.Context, e models.LiquidityEvent) error {
	_, err := t.tx.Exec(ctx, `
		INSERT INTO liquidity_events (chain_id, tx_hash, log_index, block_number, block_hash, timestamp,
		                              pair_address, event_type, sender, recipient,
		                              amount0, amount1, amount_usd)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric,$12::numeric,$13::numeric)
		ON CONFLICT (tx_hash, log_index) DO NOTHING`,
		e.ChainID, e.TxHash, e.LogIndex, e.BlockNumber, e.BlockHash, e.Timestamp,
		e.PairAddress, string(e.EventType), e.Sender, e.Recipient,
		num(e.Amount0), num(e.Amount1), numPtr(e.AmountUSD))
	if err != nil {
		return fmt.Errorf("database: inserting liquidity event %s/%d: %w", e.TxHash, e.LogIndex, err)
	}
	return nil
}

// ------------------------------------------------------------------- reorg ---

// RollbackFrom removes everything at or above a block (llm.txt s19).
//
// Chain-derived rows carry block_number precisely so a reorg can be undone
// exactly. Pair reserves are NOT reconstructed here: the caller replays the
// canonical blocks, and the Sync events in them restore authoritative reserves.
func (t *Tx) RollbackFrom(ctx context.Context, block uint64) error {
	// Snapshots are keyed by time bucket, not by block, so they cannot be deleted
	// by block range. Drop every bucket the orphaned blocks touched: the replay
	// rewrites the ones that still have a Sync, and a bucket whose only Sync was
	// orphaned correctly disappears instead of lingering as a stale close.
	// This must run before the blocks themselves are deleted.
	if _, err := t.tx.Exec(ctx, `
		WITH cutoff AS (SELECT min(timestamp) AS ts FROM blocks WHERE number >= $1)
		DELETE FROM pair_snapshots ps
		 USING cutoff c
		 WHERE c.ts IS NOT NULL
		   AND ps.timestamp_bucket >= (c.ts / ps.bucket_seconds) * ps.bucket_seconds`,
		block); err != nil {
		return fmt.Errorf("database: dropping snapshots from %d: %w", block, err)
	}

	for _, stmt := range []string{
		`DELETE FROM swaps WHERE block_number >= $1`,
		`DELETE FROM liquidity_events WHERE block_number >= $1`,
		`DELETE FROM token_prices WHERE block_number >= $1`,
		`DELETE FROM pairs WHERE created_block >= $1`,
		`DELETE FROM blocks WHERE number >= $1`,
	} {
		if _, err := t.tx.Exec(ctx, stmt, block); err != nil {
			return fmt.Errorf("database: rolling back from %d: %w", block, err)
		}
	}
	// Snapshots are keyed by time bucket, not block, so they are recomputed from
	// the replayed events rather than deleted by range.
	if _, err := t.tx.Exec(ctx, `
		DELETE FROM pair_snapshots ps
		 WHERE NOT EXISTS (SELECT 1 FROM pairs p WHERE p.address = ps.pair_address)`); err != nil {
		return fmt.Errorf("database: pruning snapshots: %w", err)
	}
	return nil
}
