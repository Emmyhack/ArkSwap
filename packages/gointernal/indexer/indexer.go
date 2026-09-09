// Package indexer ingests ArkSwap events into PostgreSQL.
package indexer

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"sort"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/analytics"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/chain"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/config"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/contracts"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/database"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/pricing"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/processor"
)

type Indexer struct {
	cfg   *config.Config
	rpc   *chain.Client
	store *database.Store
	log   *slog.Logger

	// knownPairs is the canonical pair set, discovered only from factory
	// PairCreated events. llm.txt s15 forbids a hand-maintained pair list.
	knownPairs map[string]models.Pair
	// knownTokens caches decimals and the stable flag so each swap can be valued
	// from its stablecoin leg without an extra round trip per event.
	knownTokens map[string]models.Token
	// batchSize adapts downward when the node refuses a range (llm.txt s16).
	batchSize uint64
}

func New(cfg *config.Config, rpc *chain.Client, store *database.Store, log *slog.Logger) *Indexer {
	return &Indexer{
		cfg: cfg, rpc: rpc, store: store, log: log,
		knownPairs:  map[string]models.Pair{},
		knownTokens: map[string]models.Token{},
		batchSize:  cfg.BlockBatchSize,
	}
}

// Preflight performs the startup checks in llm.txt s15 before any writing.
//
// Each is a guard against indexing something that looks fine but is silently
// wrong: the wrong chain, or an address with no contract at all, would both
// produce an empty database rather than an error.
func (ix *Indexer) Preflight(ctx context.Context) error {
	id, err := ix.rpc.ChainID(ctx)
	if err != nil {
		return fmt.Errorf("preflight: reading chain id: %w", err)
	}
	if id != ix.cfg.ChainID {
		return fmt.Errorf("preflight: connected to chain %d but configured for %d", id, ix.cfg.ChainID)
	}

	hasCode, err := ix.rpc.HasCode(ctx, ix.cfg.FactoryAddress)
	if err != nil {
		return fmt.Errorf("preflight: reading factory code: %w", err)
	}
	if !hasCode {
		return fmt.Errorf("preflight: no contract at factory address %s", ix.cfg.FactoryAddress)
	}

	if err := ix.store.Migrate(ctx); err != nil {
		return fmt.Errorf("preflight: migrations: %w", err)
	}

	pairs, err := ix.store.Pairs(ctx)
	if err != nil {
		return fmt.Errorf("preflight: loading pairs: %w", err)
	}
	for _, p := range pairs {
		ix.knownPairs[p.Address] = p
	}
	toks, err := ix.store.Tokens(ctx)
	if err != nil {
		return fmt.Errorf("preflight: loading tokens: %w", err)
	}
	for _, t := range toks {
		ix.knownTokens[t.Address] = t
	}

	ix.log.Info("preflight ok",
		"chainId", id, "factory", ix.cfg.FactoryAddress,
		"knownPairs", len(ix.knownPairs), "startBatch", ix.batchSize)
	return nil
}

// StartBlock resolves where to resume (llm.txt s8).
func (ix *Indexer) StartBlock(ctx context.Context) (uint64, error) {
	st, err := ix.store.IndexerState(ctx, ix.cfg.ChainID)
	if err != nil {
		return 0, err
	}
	if st == nil {
		// Never scan from genesis: on a long-lived chain that is hours of work
		// indexing blocks that predate the factory.
		return ix.cfg.FactoryDeployBlock, nil
	}
	return st.LastProcessedBlock + 1, nil
}

// SafeBlock is the highest block considered settled (llm.txt s18).
func (ix *Indexer) SafeBlock(head uint64) uint64 {
	if head < ix.cfg.Confirmations {
		return 0
	}
	return head - ix.cfg.Confirmations
}

// Run drives sync until the context is cancelled.
func (ix *Indexer) Run(ctx context.Context, pollInterval time.Duration) error {
	if err := ix.Preflight(ctx); err != nil {
		return err
	}
	for {
		if err := ix.Tick(ctx); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// Resume from the last committed block on the next tick; nothing is
			// lost because the cursor only advances with committed data.
			ix.log.Error("sync tick failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}

// Tick advances the indexer by at most one batch.
func (ix *Indexer) Tick(ctx context.Context) error {
	head, err := ix.rpc.BlockNumber(ctx)
	if err != nil {
		return err
	}
	safe := ix.SafeBlock(head)

	if err := ix.checkReorg(ctx); err != nil {
		return err
	}

	from, err := ix.StartBlock(ctx)
	if err != nil {
		return err
	}
	if from > safe {
		return nil // caught up
	}

	to := from + ix.batchSize - 1
	if to > safe {
		to = safe
	}
	return ix.processRange(ctx, from, to)
}

// checkReorg verifies the committed cursor still sits on the canonical chain
// (llm.txt s19).
//
// Rather than storing every block header, the indexer re-reads the header at its
// own cursor. If the hash changed, the chain reorganised beneath it; it then
// walks back to the last block whose stored hash still matches and rolls
// everything above that away. Replaying those blocks restores reserves, because
// Sync is authoritative.
func (ix *Indexer) checkReorg(ctx context.Context) error {
	st, err := ix.store.IndexerState(ctx, ix.cfg.ChainID)
	if err != nil || st == nil {
		return err
	}

	current, err := ix.rpc.HeaderByNumber(ctx, st.LastProcessedBlock)
	if err != nil {
		return err
	}
	if current.Hash == st.LastProcessedBlockHash {
		return nil
	}

	ix.log.Warn("reorg detected",
		"block", st.LastProcessedBlock,
		"storedHash", st.LastProcessedBlockHash, "chainHash", current.Hash)

	ancestor := st.LastProcessedBlock
	for ancestor > ix.cfg.FactoryDeployBlock {
		ancestor--
		storedHash, ok, err := ix.store.BlockHash(ctx, ancestor)
		if err != nil {
			return err
		}
		if !ok {
			continue // block held no events, so nothing was stored for it
		}
		h, err := ix.rpc.HeaderByNumber(ctx, ancestor)
		if err != nil {
			return err
		}
		if h.Hash == storedHash {
			break
		}
	}

	ix.log.Warn("rolling back to common ancestor", "ancestor", ancestor)
	err = ix.store.InBlockTx(ctx, func(tx *database.Tx) error {
		if err := tx.RollbackFrom(ctx, ancestor+1); err != nil {
			return err
		}
		h, err := ix.rpc.HeaderByNumber(ctx, ancestor)
		if err != nil {
			return err
		}
		return tx.SetIndexerState(ctx, models.IndexerState{
			ChainID: ix.cfg.ChainID, LastProcessedBlock: ancestor, LastProcessedBlockHash: h.Hash,
		})
	})
	if err != nil {
		return err
	}

	// Pairs created in the rolled-back range no longer exist.
	ix.knownPairs = map[string]models.Pair{}
	pairs, err := ix.store.Pairs(ctx)
	if err != nil {
		return err
	}
	for _, p := range pairs {
		ix.knownPairs[p.Address] = p
	}
	return nil
}

// processRange ingests [from, to].
func (ix *Indexer) processRange(ctx context.Context, from, to uint64) error {
	logs, err := ix.fetchLogs(ctx, from, to)
	if err != nil {
		if chain.RangeTooLarge(err) && ix.batchSize > 1 {
			// Nodes disagree on both the limit and the wording, so halve and let
			// the next tick retry rather than trying to parse a limit out.
			ix.batchSize /= 2
			ix.log.Warn("node refused block range; reducing batch", "batchSize", ix.batchSize)
			return nil
		}
		return err
	}

	sort.Slice(logs, func(i, j int) bool {
		if logs[i].BlockNumber != logs[j].BlockNumber {
			return logs[i].BlockNumber < logs[j].BlockNumber
		}
		return logs[i].Index < logs[j].Index
	})

	byBlock := map[uint64][]types.Log{}
	var blockNums []uint64
	for _, l := range logs {
		if _, seen := byBlock[l.BlockNumber]; !seen {
			blockNums = append(blockNums, l.BlockNumber)
		}
		byBlock[l.BlockNumber] = append(byBlock[l.BlockNumber], l)
	}
	sort.Slice(blockNums, func(i, j int) bool { return blockNums[i] < blockNums[j] })

	for _, bn := range blockNums {
		if err := ix.processBlock(ctx, bn, byBlock[bn]); err != nil {
			return err
		}
	}

	// Advance the cursor to the end of the range even when it held no events,
	// so an empty stretch of chain is not rescanned forever.
	head, err := ix.rpc.HeaderByNumber(ctx, to)
	if err != nil {
		return err
	}
	if err := ix.store.InBlockTx(ctx, func(tx *database.Tx) error {
		return tx.SetIndexerState(ctx, models.IndexerState{
			ChainID: ix.cfg.ChainID, LastProcessedBlock: to, LastProcessedBlockHash: head.Hash,
		})
	}); err != nil {
		return err
	}

	ix.log.Info("range indexed", "from", from, "to", to, "logs", len(logs), "pairs", len(ix.knownPairs))
	return nil
}

// fetchLogs collects factory and pair events for a range.
//
// Two queries, filtered by address, rather than one topic-only sweep: filtering
// by topic alone would also pick up any other Uniswap V2 fork on the same chain
// and silently index its pools as ArkSwap markets.
func (ix *Indexer) fetchLogs(ctx context.Context, from, to uint64) ([]types.Log, error) {
	factoryLogs, err := ix.rpc.FilterLogs(ctx, from, to,
		[]common.Address{common.HexToAddress(ix.cfg.FactoryAddress)},
		[][]common.Hash{{contracts.TopicPairCreated}})
	if err != nil {
		return nil, err
	}

	// Pairs created inside this range must have their own events indexed too, so
	// the address set is extended before the second query.
	pairAddrs := make([]common.Address, 0, len(ix.knownPairs)+len(factoryLogs))
	for addr := range ix.knownPairs {
		pairAddrs = append(pairAddrs, common.HexToAddress(addr))
	}
	for _, l := range factoryLogs {
		if ev, err := contracts.DecodePairCreated(l); err == nil {
			pairAddrs = append(pairAddrs, ev.Pair)
		}
	}

	all := factoryLogs
	if len(pairAddrs) > 0 {
		pairLogs, err := ix.rpc.FilterLogs(ctx, from, to, pairAddrs, [][]common.Hash{{
			contracts.TopicSwap, contracts.TopicSync, contracts.TopicMint, contracts.TopicBurn,
		}})
		if err != nil {
			return nil, err
		}
		all = append(all, pairLogs...)
	}
	return all, nil
}

// processBlock writes one block and all its events atomically (llm.txt s40).
func (ix *Indexer) processBlock(ctx context.Context, number uint64, logs []types.Log) error {
	header, err := ix.rpc.HeaderByNumber(ctx, number)
	if err != nil {
		return err
	}

	// Token metadata is fetched outside the transaction: it is a network call
	// per new token and must not hold a database transaction open.
	newTokens := map[string]models.Token{}
	for _, l := range logs {
		if len(l.Topics) == 0 || l.Topics[0] != contracts.TopicPairCreated {
			continue
		}
		ev, err := contracts.DecodePairCreated(l)
		if err != nil {
			continue
		}
		for _, addr := range []common.Address{ev.Token0, ev.Token1} {
			key := models.NormalizeAddress(addr.Hex())
			if _, seen := newTokens[key]; seen {
				continue
			}
			t := ix.rpc.TokenMetadata(ctx, key)
			ix.applyTokenFlags(&t)
			newTokens[key] = t
			ix.knownTokens[key] = t
		}
	}

	return ix.store.InBlockTx(ctx, func(tx *database.Tx) error {
		if err := tx.InsertBlock(ctx, *header); err != nil {
			return err
		}
		for _, t := range newTokens {
			if err := tx.UpsertToken(ctx, t); err != nil {
				return err
			}
		}
		for _, l := range logs {
			if err := ix.applyLog(ctx, tx, l, header); err != nil {
				return err
			}
		}
		if err := ix.snapshotPairs(ctx, tx, header, syncedPairs(logs)); err != nil {
			return err
		}
		return tx.SetIndexerState(ctx, models.IndexerState{
			ChainID: ix.cfg.ChainID, LastProcessedBlock: number, LastProcessedBlockHash: header.Hash,
		})
	})
}

// applyTokenFlags marks configured stablecoins and WKASH.
//
// Both come from configuration, never from the token's own symbol: llm.txt s23
// is explicit that stability must not be inferred from text a token controls.
func (ix *Indexer) applyTokenFlags(t *models.Token) {
	if t.Address == models.NormalizeAddress(ix.cfg.WKASHAddress) {
		t.IsWKASH = true
	}
	for _, s := range ix.cfg.StablecoinAddresses {
		if t.Address == models.NormalizeAddress(s) {
			t.IsStable = true
		}
	}
}

func (ix *Indexer) applyLog(ctx context.Context, tx *database.Tx, l types.Log, header *models.Block) error {
	if len(l.Topics) == 0 {
		return nil
	}
	pairAddr := models.NormalizeAddress(l.Address.Hex())

	switch l.Topics[0] {
	case contracts.TopicPairCreated:
		ev, err := contracts.DecodePairCreated(l)
		if err != nil {
			ix.log.Warn("skipping malformed PairCreated", "tx", l.TxHash.Hex(), "error", err)
			return nil
		}
		p := models.Pair{
			Address:          models.NormalizeAddress(ev.Pair.Hex()),
			Token0Address:    models.NormalizeAddress(ev.Token0.Hex()),
			Token1Address:    models.NormalizeAddress(ev.Token1.Hex()),
			Reserve0:         big.NewInt(0),
			Reserve1:         big.NewInt(0),
			TotalSupply:      big.NewInt(0),
			CreatedBlock:     l.BlockNumber,
			CreatedTxHash:    models.NormalizeAddress(l.TxHash.Hex()),
			CreatedLogIndex:  l.Index,
			CreatedTimestamp: header.Timestamp,
		}
		if err := tx.UpsertPair(ctx, p); err != nil {
			return err
		}
		ix.knownPairs[p.Address] = p
		return nil

	case contracts.TopicSync:
		ev, err := contracts.DecodeSync(l)
		if err != nil {
			ix.log.Warn("skipping malformed Sync", "tx", l.TxHash.Hex(), "error", err)
			return nil
		}
		if err := tx.SetPairReserves(ctx, pairAddr, ev.Reserve0, ev.Reserve1, l.BlockNumber); err != nil {
			return err
		}
		// Mirror the write into the in-memory pair set. Snapshots and the pricing
		// engine both read from it, and a stale copy here would price this block
		// against the previous block's reserves.
		if p, ok := ix.knownPairs[pairAddr]; ok {
			p.Reserve0, p.Reserve1, p.LastSyncBlock = ev.Reserve0, ev.Reserve1, &l.BlockNumber
			ix.knownPairs[pairAddr] = p
		}
		return nil

	case contracts.TopicSwap:
		ev, err := contracts.DecodeSwap(l)
		if err != nil {
			ix.log.Warn("skipping malformed Swap", "tx", l.TxHash.Hex(), "error", err)
			return nil
		}
		p, ok := ix.knownPairs[pairAddr]
		if !ok {
			// An event from a pair the factory never created is not canonical.
			return nil
		}
		s := models.Swap{
			ChainID: ix.cfg.ChainID,
			TxHash:  models.NormalizeAddress(l.TxHash.Hex()), LogIndex: l.Index,
			BlockNumber: l.BlockNumber, BlockHash: header.Hash, Timestamp: header.Timestamp,
			PairAddress: pairAddr,
			Sender:      models.NormalizeAddress(ev.Sender.Hex()),
			Recipient:   models.NormalizeAddress(ev.To.Hex()),
			Amount0In:   ev.Amount0In, Amount1In: ev.Amount1In,
			Amount0Out: ev.Amount0Out, Amount1Out: ev.Amount1Out,
		}
		processor.NormalizeSwap(&s, p.Token0Address, p.Token1Address)

		// Value the trade from whichever side is an approved USD anchor. Doing it
		// here rather than at read time keeps the figure historical: it reflects
		// what changed hands in this block, not today's pool price applied
		// retroactively (llm.txt s27).
		if s.Direction != models.DirectionUnknown && s.TokenInAddress != nil && s.TokenOutAddress != nil {
			s.AmountUSD = processor.StableLegUSD(
				ix.knownTokens[*s.TokenInAddress], s.AmountIn,
				ix.knownTokens[*s.TokenOutAddress], s.AmountOut,
			)
		}
		return tx.InsertSwap(ctx, s)

	case contracts.TopicMint:
		ev, err := contracts.DecodeMint(l)
		if err != nil {
			ix.log.Warn("skipping malformed Mint", "tx", l.TxHash.Hex(), "error", err)
			return nil
		}
		sender := models.NormalizeAddress(ev.Sender.Hex())
		return tx.InsertLiquidityEvent(ctx, models.LiquidityEvent{
			ChainID: ix.cfg.ChainID,
			TxHash:  models.NormalizeAddress(l.TxHash.Hex()), LogIndex: l.Index,
			BlockNumber: l.BlockNumber, BlockHash: header.Hash, Timestamp: header.Timestamp,
			PairAddress: pairAddr, EventType: models.LiquidityMint,
			Sender: &sender, Amount0: ev.Amount0, Amount1: ev.Amount1,
			AmountUSD: ix.liquidityUSD(pairAddr, ev.Amount0, ev.Amount1),
		})

	case contracts.TopicBurn:
		ev, err := contracts.DecodeBurn(l)
		if err != nil {
			ix.log.Warn("skipping malformed Burn", "tx", l.TxHash.Hex(), "error", err)
			return nil
		}
		sender := models.NormalizeAddress(ev.Sender.Hex())
		to := models.NormalizeAddress(ev.To.Hex())
		return tx.InsertLiquidityEvent(ctx, models.LiquidityEvent{
			ChainID: ix.cfg.ChainID,
			TxHash:  models.NormalizeAddress(l.TxHash.Hex()), LogIndex: l.Index,
			BlockNumber: l.BlockNumber, BlockHash: header.Hash, Timestamp: header.Timestamp,
			PairAddress: pairAddr, EventType: models.LiquidityBurn,
			Sender: &sender, Recipient: &to, Amount0: ev.Amount0, Amount1: ev.Amount1,
			AmountUSD: ix.liquidityUSD(pairAddr, ev.Amount0, ev.Amount1),
		})
	}
	return nil
}

// SyncToHead drains the backlog and returns once the indexer has caught up.
//
// Used by --once for backfills and by the integration tests, where a run that
// exits on completion is far easier to assert on than a long-lived loop.
func (ix *Indexer) SyncToHead(ctx context.Context) error {
	for {
		head, err := ix.rpc.BlockNumber(ctx)
		if err != nil {
			return err
		}
		safe := ix.SafeBlock(head)
		from, err := ix.StartBlock(ctx)
		if err != nil {
			return err
		}
		if from > safe {
			return nil
		}
		if err := ix.Tick(ctx); err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
}

// liquidityUSD values a mint or burn from its stablecoin side, doubled.
//
// At equilibrium a constant-product pool holds equal value on both sides, so one
// priced side times two is the standard estimate for the whole deposit. Returns
// nil when neither side is an anchor rather than guessing.
// syncedPairs lists the pairs whose reserves changed in a block.
//
// Sync is the only event that moves reserves, so it is the only one that can
// change a bucket's close. Blocks with no Sync write no snapshots at all, which
// keeps the table proportional to activity rather than to chain length.
func syncedPairs(logs []types.Log) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, l := range logs {
		if len(l.Topics) == 0 || l.Topics[0] != contracts.TopicSync {
			continue
		}
		addr := models.NormalizeAddress(l.Address.Hex())
		if _, dup := seen[addr]; dup {
			continue
		}
		seen[addr] = struct{}{}
		out = append(out, addr)
	}
	return out
}

// snapshotPairs closes the hour and day buckets containing this block for every
// pair whose reserves just changed.
//
// Prices are computed from the reserves as they stand in this block, never from
// today's pool state applied backwards: a chart built from retroactive prices
// shows a history that never happened (llm.txt s27). A pool with no route to a
// stablecoin stores its reserves with NULL prices and NULL TVL rather than a
// fabricated series (llm.txt s26).
func (ix *Indexer) snapshotPairs(ctx context.Context, tx *database.Tx, header *models.Block, pairs []string) error {
	if len(pairs) == 0 {
		return nil
	}
	engine := ix.pricingEngine()

	for _, addr := range pairs {
		p, ok := ix.knownPairs[addr]
		if !ok {
			continue // not a factory pair; not canonical (llm.txt s15)
		}
		t0, t1 := ix.knownTokens[p.Token0Address], ix.knownTokens[p.Token1Address]

		var price0, price1 *big.Rat
		if pr := engine.PriceUSD(t0); pr != nil {
			price0 = pr.USD
		}
		if pr := engine.PriceUSD(t1); pr != nil {
			price1 = pr.USD
		}

		snap := models.PairSnapshot{
			PairAddress:    addr,
			Reserve0:       p.Reserve0,
			Reserve1:       p.Reserve1,
			Token0PriceUSD: price0,
			Token1PriceUSD: price1,
			TVLUSD:         analytics.PairTVL(p.Reserve0, t0, price0, p.Reserve1, t1, price1),
		}

		for _, bucket := range []uint64{models.BucketHour, models.BucketDay} {
			snap.BucketSeconds = bucket
			snap.TimestampBucket = models.FloorBucket(header.Timestamp, bucket)
			if err := tx.UpsertPairSnapshot(ctx, snap); err != nil {
				return err
			}
		}
	}
	return nil
}

// pricingEngine prices against every known pair at its current reserves.
//
// The whole pair set is used, not just the pair being snapshotted: pricing a
// token may need a hop through WKASH, which lives in a different pool.
func (ix *Indexer) pricingEngine() *pricing.Engine {
	pools := make([]pricing.Pool, 0, len(ix.knownPairs))
	for _, p := range ix.knownPairs {
		pools = append(pools, pricing.Pool{
			Address:  p.Address,
			Token0:   ix.knownTokens[p.Token0Address],
			Token1:   ix.knownTokens[p.Token1Address],
			Reserve0: p.Reserve0,
			Reserve1: p.Reserve1,
		})
	}
	// Map iteration order is random; sorting keeps a tie between two equally deep
	// pools from resolving differently on separate runs.
	pricing.SortPoolsByAddress(pools)
	return pricing.NewEngine(pools, ix.cfg.MinPriceLiquidityUSD)
}

func (ix *Indexer) liquidityUSD(pairAddr string, amount0, amount1 *big.Int) *big.Rat {
	p, ok := ix.knownPairs[pairAddr]
	if !ok {
		return nil
	}
	t0 := ix.knownTokens[p.Token0Address]
	t1 := ix.knownTokens[p.Token1Address]

	var side *big.Rat
	if t0.IsStable {
		if v, ok := models.ScaleDown(amount0, t0.Decimals); ok {
			side = v
		}
	}
	if side == nil && t1.IsStable {
		if v, ok := models.ScaleDown(amount1, t1.Decimals); ok {
			side = v
		}
	}
	if side == nil {
		return nil
	}
	return new(big.Rat).Mul(side, big.NewRat(2, 1))
}
