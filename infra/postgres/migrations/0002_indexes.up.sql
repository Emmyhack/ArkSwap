-- Query indexes (llm.txt s39).
--
-- Every index here backs a specific API endpoint or the reorg path; none are
-- speculative. The API paginates everything, so the ordering columns are part of
-- the index rather than left to a sort.

BEGIN;

-- GET /pairs/{address}/swaps — newest first, paginated.
CREATE INDEX IF NOT EXISTS swaps_pair_timestamp_idx
    ON swaps (pair_address, timestamp DESC, log_index DESC);

-- 24h / 7d volume windows in GET /stats.
CREATE INDEX IF NOT EXISTS swaps_timestamp_idx ON swaps (timestamp DESC);

-- Reorg rollback deletes by block range.
CREATE INDEX IF NOT EXISTS swaps_block_number_idx ON swaps (block_number);

-- GET /accounts/{address}/swaps covers both sides of the trade.
CREATE INDEX IF NOT EXISTS swaps_sender_idx    ON swaps (sender, timestamp DESC);
CREATE INDEX IF NOT EXISTS swaps_recipient_idx ON swaps (recipient, timestamp DESC);

CREATE INDEX IF NOT EXISTS swaps_token_in_idx  ON swaps (token_in_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS swaps_token_out_idx ON swaps (token_out_address, timestamp DESC);

-- GET /pairs/{address}/liquidity, and reorg rollback.
CREATE INDEX IF NOT EXISTS liquidity_events_pair_timestamp_idx
    ON liquidity_events (pair_address, timestamp DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS liquidity_events_block_number_idx
    ON liquidity_events (block_number);

-- GET /pairs/{address}/chart. The unique constraint already covers the exact
-- key; this serves range scans over a bucket size.
CREATE INDEX IF NOT EXISTS pair_snapshots_lookup_idx
    ON pair_snapshots (pair_address, bucket_seconds, timestamp_bucket DESC);
CREATE INDEX IF NOT EXISTS pair_snapshots_block_idx
    ON pair_snapshots (timestamp_bucket);

-- GET /pairs?token=... filters on either side.
CREATE INDEX IF NOT EXISTS pairs_token0_idx        ON pairs (token0_address);
CREATE INDEX IF NOT EXISTS pairs_token1_idx        ON pairs (token1_address);
CREATE INDEX IF NOT EXISTS pairs_created_block_idx ON pairs (created_block);

-- Token search / listing.
CREATE INDEX IF NOT EXISTS tokens_symbol_idx ON tokens (symbol);

-- Latest price per token.
CREATE INDEX IF NOT EXISTS token_prices_latest_idx
    ON token_prices (token_address, block_number DESC);

COMMIT;
