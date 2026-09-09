package database

import (
	"context"
	"math/big"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

// testStore connects to a scratch database and applies the embedded migrations.
// Skips rather than fails when no database is configured, so `go test ./...`
// stays useful on a machine without PostgreSQL.
func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://arkswap:arkswap@localhost:5432/arkswap_test?sslmode=disable"
	}
	ctx := context.Background()
	s, err := Connect(ctx, url)
	if err != nil {
		t.Skipf("no test database available (%v)", err)
	}
	t.Cleanup(s.Close)

	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	// Each test starts from a clean slate.
	if _, err := s.pool.Exec(ctx, `
		TRUNCATE swaps, liquidity_events, pair_snapshots, token_prices,
		         pairs, tokens, blocks, indexer_state RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return s
}

func mustInt(s string) *big.Int {
	v, _ := new(big.Int).SetString(s, 10)
	return v
}

const (
	tokA = "0x6792d2fd02d8a55c543f627d0e90526f9278c6d6"
	tokB = "0xc8d15f9a42ee3107ab1257e38199e3bf899dcfb3"
	pair = "0x022850a98a241ff9e3978cd1b596295cf1451719"
)

func seedPair(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	dec := 18
	dec6 := 6
	err := s.InBlockTx(ctx, func(tx *Tx) error {
		if err := tx.UpsertToken(ctx, models.Token{Address: tokA, Decimals: &dec, MetadataComplete: true, IsWKASH: true}); err != nil {
			return err
		}
		if err := tx.UpsertToken(ctx, models.Token{Address: tokB, Decimals: &dec6, MetadataComplete: true, IsStable: true}); err != nil {
			return err
		}
		return tx.UpsertPair(ctx, models.Pair{
			Address: pair, Token0Address: tokA, Token1Address: tokB,
			Reserve0: big.NewInt(0), Reserve1: big.NewInt(0), TotalSupply: big.NewInt(0),
			CreatedBlock: 177509, CreatedTxHash: "0xabc", CreatedLogIndex: 0, CreatedTimestamp: 1788405514,
		})
	})
	if err != nil {
		t.Fatalf("seedPair: %v", err)
	}
}

func TestMigrationsCreateEverySchemaObject(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, tbl := range []string{
		"indexer_state", "blocks", "tokens", "pairs",
		"swaps", "liquidity_events", "pair_snapshots", "token_prices",
	} {
		var exists bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1)`, tbl,
		).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if !exists {
			t.Errorf("table %s missing", tbl)
		}
	}
}

func TestMigrateIsIdempotent(t *testing.T) {
	s := testStore(t)
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatalf("re-running Migrate must be a no-op: %v", err)
	}
}

// llm.txt s20: reprocessing a log must never double-count. This is the single
// most important database property for financial correctness.
func TestDuplicateSwapIsIgnored(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()

	sw := models.Swap{
		ChainID: 9000, TxHash: "0xdead", LogIndex: 3, BlockNumber: 177604,
		BlockHash: "0xblk", Timestamp: 1788405600, PairAddress: pair,
		Sender: "0xr", Recipient: "0xu",
		Amount0In: mustInt("1000000000000000000"), Amount1In: big.NewInt(0),
		Amount0Out: big.NewInt(0), Amount1Out: big.NewInt(921977),
		AmountUSD: big.NewRat(1204957, 1000000),
	}

	for i := 0; i < 3; i++ {
		if err := s.InBlockTx(ctx, func(tx *Tx) error { return tx.InsertSwap(ctx, sw) }); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}

	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM swaps`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("swap rows = %d after 3 inserts of the same log; want 1", n)
	}

	var total string
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE(sum(amount_usd),0)::text FROM swaps`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	got, _ := new(big.Rat).SetString(total)
	if got.Cmp(big.NewRat(1204957, 1000000)) != 0 {
		t.Fatalf("volume = %s; replay double-counted", total)
	}
}

func TestDuplicateLiquidityEventIsIgnored(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()
	ev := models.LiquidityEvent{
		ChainID: 9000, TxHash: "0xmint", LogIndex: 1, BlockNumber: 177510,
		BlockHash: "0xblk", Timestamp: 1788405520, PairAddress: pair,
		EventType: models.LiquidityMint, Amount0: mustInt("40000000000000000000"), Amount1: big.NewInt(40_000_000),
	}
	for i := 0; i < 2; i++ {
		if err := s.InBlockTx(ctx, func(tx *Tx) error { return tx.InsertLiquidityEvent(ctx, ev) }); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	s.pool.QueryRow(ctx, `SELECT count(*) FROM liquidity_events`).Scan(&n)
	if n != 1 {
		t.Fatalf("liquidity rows = %d, want 1", n)
	}
}

// llm.txt s40: a block commits atomically. A failure part-way must leave no
// trace, or the cursor could later skip past rows that were never written.
func TestBlockTransactionRollsBackEntirely(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()

	wantErr := context.Canceled
	err := s.InBlockTx(ctx, func(tx *Tx) error {
		if err := tx.InsertBlock(ctx, models.Block{Number: 999, Hash: "0xh", ParentHash: "0xp", Timestamp: 1}); err != nil {
			return err
		}
		if err := tx.InsertSwap(ctx, models.Swap{
			ChainID: 9000, TxHash: "0xpartial", LogIndex: 0, BlockNumber: 999,
			BlockHash: "0xh", Timestamp: 1, PairAddress: pair, Sender: "0xa", Recipient: "0xb",
			Amount0In: big.NewInt(1), Amount1In: big.NewInt(0),
			Amount0Out: big.NewInt(0), Amount1Out: big.NewInt(1),
		}); err != nil {
			return err
		}
		return wantErr // abort after partial work
	})
	if err == nil {
		t.Fatal("expected the transaction to fail")
	}

	var blocks, swaps int
	s.pool.QueryRow(ctx, `SELECT count(*) FROM blocks WHERE number = 999`).Scan(&blocks)
	s.pool.QueryRow(ctx, `SELECT count(*) FROM swaps WHERE tx_hash = '0xpartial'`).Scan(&swaps)
	if blocks != 0 || swaps != 0 {
		t.Fatalf("rollback left data behind: blocks=%d swaps=%d", blocks, swaps)
	}
}

// A failed metadata read must not blank metadata captured earlier.
func TestUpsertTokenNeverDowngradesMetadata(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	sym, name := "mUSDC", "Mock USD Coin"
	dec := 6

	if err := s.InBlockTx(ctx, func(tx *Tx) error {
		return tx.UpsertToken(ctx, models.Token{
			Address: tokB, Symbol: &sym, Name: &name, Decimals: &dec, MetadataComplete: true, IsStable: true,
		})
	}); err != nil {
		t.Fatal(err)
	}
	// A later read where every call reverted.
	if err := s.InBlockTx(ctx, func(tx *Tx) error {
		return tx.UpsertToken(ctx, models.Token{Address: tokB})
	}); err != nil {
		t.Fatal(err)
	}

	toks, err := s.Tokens(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got *models.Token
	for i := range toks {
		if toks[i].Address == tokB {
			got = &toks[i]
		}
	}
	if got == nil || got.Symbol == nil || *got.Symbol != "mUSDC" || got.Decimals == nil || *got.Decimals != 6 {
		t.Fatalf("metadata was downgraded: %+v", got)
	}
	if !got.MetadataComplete || !got.IsStable {
		t.Fatalf("flags were downgraded: %+v", got)
	}
}

// Sync is authoritative for reserves, but an out-of-order write must not move
// them backwards.
func TestSetPairReservesIgnoresStaleBlocks(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()

	set := func(r0 int64, block uint64) {
		if err := s.InBlockTx(ctx, func(tx *Tx) error {
			return tx.SetPairReserves(ctx, pair, big.NewInt(r0), big.NewInt(1), block)
		}); err != nil {
			t.Fatal(err)
		}
	}
	set(100, 200)
	set(50, 150) // stale
	ps, err := s.Pairs(ctx)
	if err != nil || len(ps) != 1 {
		t.Fatalf("pairs: %v %d", err, len(ps))
	}
	if ps[0].Reserve0.Int64() != 100 {
		t.Fatalf("reserve0 = %v; a stale Sync overwrote a newer one", ps[0].Reserve0)
	}
}

// llm.txt s19: rolling back a reorg removes every chain-derived row at or above
// the fork point, so replay cannot double-count.
func TestRollbackFromRemovesChainDerivedRows(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()

	mk := func(block uint64, hash string) {
		if err := s.InBlockTx(ctx, func(tx *Tx) error {
			if err := tx.InsertBlock(ctx, models.Block{Number: block, Hash: hash, ParentHash: "0xp", Timestamp: block}); err != nil {
				return err
			}
			return tx.InsertSwap(ctx, models.Swap{
				ChainID: 9000, TxHash: hash, LogIndex: 0, BlockNumber: block, BlockHash: hash,
				Timestamp: block, PairAddress: pair, Sender: "0xa", Recipient: "0xb",
				Amount0In: big.NewInt(1), Amount1In: big.NewInt(0),
				Amount0Out: big.NewInt(0), Amount1Out: big.NewInt(1),
			})
		}); err != nil {
			t.Fatal(err)
		}
	}
	mk(177600, "0xa1")
	mk(177601, "0xa2")
	mk(177602, "0xa3")

	if err := s.InBlockTx(ctx, func(tx *Tx) error { return tx.RollbackFrom(ctx, 177601) }); err != nil {
		t.Fatal(err)
	}

	var blocks, swaps int
	s.pool.QueryRow(ctx, `SELECT count(*) FROM blocks`).Scan(&blocks)
	s.pool.QueryRow(ctx, `SELECT count(*) FROM swaps`).Scan(&swaps)
	if blocks != 1 || swaps != 1 {
		t.Fatalf("after rollback: blocks=%d swaps=%d, want 1/1", blocks, swaps)
	}
}

func TestIndexerStateRoundTrip(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	if st, err := s.IndexerState(ctx, 9000); err != nil || st != nil {
		t.Fatalf("fresh database should have no state: %+v %v", st, err)
	}
	if err := s.InBlockTx(ctx, func(tx *Tx) error {
		return tx.SetIndexerState(ctx, models.IndexerState{ChainID: 9000, LastProcessedBlock: 177472, LastProcessedBlockHash: "0xh"})
	}); err != nil {
		t.Fatal(err)
	}
	st, err := s.IndexerState(ctx, 9000)
	if err != nil || st == nil || st.LastProcessedBlock != 177472 {
		t.Fatalf("state = %+v, %v", st, err)
	}
}

// Addresses must be stored lowercase, or the same token would exist twice and
// its liquidity would be split across two identities.
func TestLowercaseAddressConstraint(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	err := s.InBlockTx(ctx, func(tx *Tx) error {
		return tx.UpsertToken(ctx, models.Token{Address: "0xC8D15F9A42EE3107AB1257E38199E3BF899DCFB3"})
	})
	if err == nil {
		t.Fatal("expected the lowercase constraint to reject a mixed-case address")
	}
}

// A bucket's snapshot is its close: the last Sync in the bucket wins, so a
// replay of the same events leaves the same row (llm.txt s20).
func TestPairSnapshotKeepsTheBucketClose(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()

	const bucket = uint64(models.BucketHour)
	base := uint64(1788404000)
	start := models.FloorBucket(base, bucket)

	write := func(r0, r1 string, tvl *big.Rat) {
		if err := s.InBlockTx(ctx, func(tx *Tx) error {
			return tx.UpsertPairSnapshot(ctx, models.PairSnapshot{
				PairAddress: pair, BucketSeconds: bucket, TimestampBucket: start,
				Reserve0: mustInt(r0), Reserve1: mustInt(r1),
				Token0PriceUSD: big.NewRat(2, 1), Token1PriceUSD: big.NewRat(1, 1),
				TVLUSD: tvl,
			})
		}); err != nil {
			t.Fatal(err)
		}
	}
	write("1000000000000000000", "1000000", big.NewRat(3, 1))
	write("2000000000000000000", "2000000", big.NewRat(6, 1))

	var rows int
	var r0, tvl string
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) OVER (), reserve0::text, tvl_usd::text FROM pair_snapshots`,
	).Scan(&rows, &r0, &tvl); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("rows = %d; the same bucket must be updated, not appended", rows)
	}
	if r0 != "2000000000000000000" {
		t.Errorf("reserve0 = %s; want the last write in the bucket", r0)
	}
	if !strings.HasPrefix(tvl, "6") {
		t.Errorf("tvl_usd = %s; want the last write in the bucket", tvl)
	}
}

// An unpriceable pool records its reserves with NULL prices. Storing zero would
// let a pool with no route to a stablecoin read as a pool worth nothing
// (llm.txt s26).
func TestPairSnapshotStoresUnknownPricesAsNull(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()

	if err := s.InBlockTx(ctx, func(tx *Tx) error {
		return tx.UpsertPairSnapshot(ctx, models.PairSnapshot{
			PairAddress: pair, BucketSeconds: models.BucketDay, TimestampBucket: 1788393600,
			Reserve0: mustInt("5"), Reserve1: mustInt("7"),
		})
	}); err != nil {
		t.Fatal(err)
	}

	var price0, tvl *string
	if err := s.pool.QueryRow(ctx,
		`SELECT token0_price_usd::text, tvl_usd::text FROM pair_snapshots`,
	).Scan(&price0, &tvl); err != nil {
		t.Fatal(err)
	}
	if price0 != nil || tvl != nil {
		t.Fatalf("price0=%v tvl=%v; unknown must stay NULL, never 0", price0, tvl)
	}
}

// The chart joins volume (from swaps) against price and TVL (from snapshots).
// Buckets present on only one side must still appear, with the missing half
// null rather than the whole bucket dropped.
func TestChartBucketsJoinsSnapshotsAndSwaps(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()

	const bucket = int64(models.BucketHour)
	// Two adjacent hours: the first traded, the second only moved liquidity.
	traded := uint64(1788404400)
	quiet := traded + uint64(bucket)

	if err := s.InBlockTx(ctx, func(tx *Tx) error {
		if err := tx.InsertBlock(ctx, models.Block{Number: 177700, Hash: "0xs1", ParentHash: "0xp", Timestamp: traded}); err != nil {
			return err
		}
		usd := big.NewRat(25, 1)
		if err := tx.InsertSwap(ctx, models.Swap{
			ChainID: 9000, TxHash: "0xs1", LogIndex: 0, BlockNumber: 177700, BlockHash: "0xs1",
			Timestamp: traded, PairAddress: pair, Sender: "0xa", Recipient: "0xb",
			Amount0In: big.NewInt(1), Amount1In: big.NewInt(0),
			Amount0Out: big.NewInt(0), Amount1Out: big.NewInt(1),
			AmountUSD: usd,
		}); err != nil {
			return err
		}
		for _, ts := range []uint64{traded, quiet} {
			if err := tx.UpsertPairSnapshot(ctx, models.PairSnapshot{
				PairAddress: pair, BucketSeconds: uint64(bucket), TimestampBucket: models.FloorBucket(ts, uint64(bucket)),
				Reserve0: mustInt("1000"), Reserve1: mustInt("2000"),
				Token0PriceUSD: big.NewRat(2, 1), Token1PriceUSD: big.NewRat(1, 1),
				TVLUSD: big.NewRat(4000, 1),
			}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	points, err := s.ChartBuckets(ctx, pair, bucket, time.Unix(int64(traded)-3600, 0))
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 2 {
		t.Fatalf("points = %d, want 2 (a bucket with no swaps must still appear)", len(points))
	}

	first, second := points[0], points[1]
	if first.TxCount != 1 || first.VolumeUSD.Cmp(big.NewRat(25, 1)) != 0 {
		t.Errorf("traded bucket: tx=%d volume=%v, want 1/25", first.TxCount, first.VolumeUSD)
	}
	if first.TVLUSD == nil || first.TVLUSD.Cmp(big.NewRat(4000, 1)) != 0 {
		t.Errorf("traded bucket tvl = %v, want 4000", first.TVLUSD)
	}
	if second.TxCount != 0 || second.VolumeUSD.Sign() != 0 {
		t.Errorf("quiet bucket: tx=%d volume=%v, want 0/0", second.TxCount, second.VolumeUSD)
	}
	if second.TVLUSD == nil {
		t.Error("quiet bucket lost its snapshot in the join")
	}
}

// A reorg must not leave a stale close behind. Snapshots carry no block number,
// so they are dropped by the buckets the orphaned blocks fall in and rebuilt
// from the replayed events (llm.txt s19).
func TestRollbackDropsSnapshotsForOrphanedBuckets(t *testing.T) {
	s := testStore(t)
	seedPair(t, s)
	ctx := context.Background()

	const bucket = uint64(models.BucketHour)
	keep := uint64(1788400800) // an earlier hour, unaffected by the rollback
	orphan := keep + bucket

	if err := s.InBlockTx(ctx, func(tx *Tx) error {
		if err := tx.InsertBlock(ctx, models.Block{Number: 177800, Hash: "0xk", ParentHash: "0xp", Timestamp: keep}); err != nil {
			return err
		}
		if err := tx.InsertBlock(ctx, models.Block{Number: 177801, Hash: "0xo", ParentHash: "0xk", Timestamp: orphan}); err != nil {
			return err
		}
		for _, ts := range []uint64{keep, orphan} {
			if err := tx.UpsertPairSnapshot(ctx, models.PairSnapshot{
				PairAddress: pair, BucketSeconds: bucket, TimestampBucket: models.FloorBucket(ts, bucket),
				Reserve0: mustInt("1"), Reserve1: mustInt("2"),
			}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.InBlockTx(ctx, func(tx *Tx) error { return tx.RollbackFrom(ctx, 177801) }); err != nil {
		t.Fatal(err)
	}

	var buckets []int64
	rows, err := s.pool.Query(ctx, `SELECT timestamp_bucket FROM pair_snapshots ORDER BY timestamp_bucket`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var b int64
		if err := rows.Scan(&b); err != nil {
			t.Fatal(err)
		}
		buckets = append(buckets, b)
	}
	want := int64(models.FloorBucket(keep, bucket))
	if len(buckets) != 1 || buckets[0] != want {
		t.Fatalf("snapshots after rollback = %v, want only the pre-fork bucket %d", buckets, want)
	}
}
