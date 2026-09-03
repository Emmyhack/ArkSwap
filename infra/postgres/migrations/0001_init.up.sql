-- ArkSwap analytics schema (llm.txt s7-s14).
--
-- PostgreSQL here is a REBUILDABLE PROJECTION of Ark Constellation history, not
-- a source of truth (llm.txt s61). Every table can be reconstructed by replaying
-- events from the factory deployment block. Nothing in this schema may be the
-- only place a fact exists.
--
-- Money and token amounts are NUMERIC, never floating point: a rounded ERC-20
-- balance is indistinguishable from a correct one (llm.txt s5).
-- EVM addresses and hashes are stored lowercase (llm.txt s10).

BEGIN;

-- Where the indexer has committed up to. Advanced only after the block's events
-- are committed in the same transaction (llm.txt s16, s40).
CREATE TABLE IF NOT EXISTS indexer_state (
    chain_id                  BIGINT      PRIMARY KEY,
    last_processed_block      BIGINT      NOT NULL,
    last_processed_block_hash TEXT        NOT NULL,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Block hashes are retained so a parent-hash mismatch can be detected and the
-- affected range rolled back (llm.txt s19).
CREATE TABLE IF NOT EXISTS blocks (
    number       BIGINT      PRIMARY KEY,
    hash         TEXT        NOT NULL,
    parent_hash  TEXT        NOT NULL,
    timestamp    BIGINT      NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- metadata_complete distinguishes "this token has no symbol" from "the symbol()
-- call reverted". Decimals stay NULL rather than defaulting to 18, because
-- guessing decimals silently corrupts every amount derived from the token
-- (llm.txt s10).
CREATE TABLE IF NOT EXISTS tokens (
    address           TEXT        PRIMARY KEY,
    symbol            TEXT,
    name              TEXT,
    decimals          INTEGER,
    metadata_complete BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Operator-curated. Being in a canonical pair does NOT make a token safe
    -- (llm.txt s46).
    is_whitelisted    BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Explicitly approved USD anchor. Never inferred from symbol text (llm.txt s23).
    is_stable         BOOLEAN     NOT NULL DEFAULT FALSE,
    is_wkash          BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tokens_address_lower CHECK (address = lower(address)),
    CONSTRAINT tokens_decimals_sane CHECK (decimals IS NULL OR (decimals >= 0 AND decimals <= 77))
);

-- Canonical pairs only: every row originates from an ArkSwapFactory PairCreated
-- event. Token ordering is the factory's (token0 < token1) and must be preserved
-- (llm.txt s11).
CREATE TABLE IF NOT EXISTS pairs (
    address           TEXT        PRIMARY KEY,
    token0_address    TEXT        NOT NULL REFERENCES tokens(address),
    token1_address    TEXT        NOT NULL REFERENCES tokens(address),
    reserve0          NUMERIC(78, 0) NOT NULL DEFAULT 0,
    reserve1          NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_supply      NUMERIC(78, 0) NOT NULL DEFAULT 0,
    created_block     BIGINT      NOT NULL,
    created_tx_hash   TEXT        NOT NULL,
    created_log_index INTEGER     NOT NULL,
    created_timestamp BIGINT      NOT NULL,
    last_sync_block   BIGINT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pairs_address_lower CHECK (address = lower(address)),
    CONSTRAINT pairs_token_order  CHECK (token0_address < token1_address),
    CONSTRAINT pairs_reserves_nonneg CHECK (reserve0 >= 0 AND reserve1 >= 0)
);

-- UNIQUE(tx_hash, log_index) is what makes replay safe: reprocessing a block
-- cannot double-count volume (llm.txt s12, s20).
CREATE TABLE IF NOT EXISTS swaps (
    id                 BIGSERIAL   PRIMARY KEY,
    chain_id           BIGINT      NOT NULL,
    tx_hash            TEXT        NOT NULL,
    log_index          INTEGER     NOT NULL,
    block_number       BIGINT      NOT NULL,
    block_hash         TEXT        NOT NULL,
    timestamp          BIGINT      NOT NULL,
    pair_address       TEXT        NOT NULL REFERENCES pairs(address) ON DELETE CASCADE,
    sender             TEXT        NOT NULL,
    recipient          TEXT        NOT NULL,
    amount0_in         NUMERIC(78, 0) NOT NULL,
    amount1_in         NUMERIC(78, 0) NOT NULL,
    amount0_out        NUMERIC(78, 0) NOT NULL,
    amount1_out        NUMERIC(78, 0) NOT NULL,
    -- Normalised direction. NULL when the raw event was malformed (both sides in,
    -- or neither) — stored rather than silently coerced (llm.txt s22).
    token_in_address   TEXT,
    token_out_address  TEXT,
    amount_in          NUMERIC(78, 0),
    amount_out         NUMERIC(78, 0),
    -- NULL when neither side had a reliable price. NULL means "unknown", which is
    -- not the same as zero and must not be summed as zero (llm.txt s23, s27).
    amount_usd         NUMERIC(38, 18),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT swaps_unique_log UNIQUE (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS liquidity_events (
    id           BIGSERIAL   PRIMARY KEY,
    chain_id     BIGINT      NOT NULL,
    tx_hash      TEXT        NOT NULL,
    log_index    INTEGER     NOT NULL,
    block_number BIGINT      NOT NULL,
    block_hash   TEXT        NOT NULL,
    timestamp    BIGINT      NOT NULL,
    pair_address TEXT        NOT NULL REFERENCES pairs(address) ON DELETE CASCADE,
    event_type   TEXT        NOT NULL,
    sender       TEXT,
    recipient    TEXT,
    amount0      NUMERIC(78, 0) NOT NULL,
    amount1      NUMERIC(78, 0) NOT NULL,
    amount_usd   NUMERIC(38, 18),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT liquidity_events_unique_log UNIQUE (tx_hash, log_index),
    CONSTRAINT liquidity_events_type CHECK (event_type IN ('MINT', 'BURN'))
);

-- Time-bucketed rollups for charts. bucket_seconds distinguishes 1h from 1d
-- rows so both live in one table without ambiguity (llm.txt s14, s35).
CREATE TABLE IF NOT EXISTS pair_snapshots (
    id               BIGSERIAL   PRIMARY KEY,
    pair_address     TEXT        NOT NULL REFERENCES pairs(address) ON DELETE CASCADE,
    bucket_seconds   INTEGER     NOT NULL,
    timestamp_bucket BIGINT      NOT NULL,
    reserve0         NUMERIC(78, 0) NOT NULL,
    reserve1         NUMERIC(78, 0) NOT NULL,
    token0_price_usd NUMERIC(38, 18),
    token1_price_usd NUMERIC(38, 18),
    tvl_usd          NUMERIC(38, 18),
    volume_usd       NUMERIC(38, 18) NOT NULL DEFAULT 0,
    tx_count         BIGINT      NOT NULL DEFAULT 0,
    CONSTRAINT pair_snapshots_unique UNIQUE (pair_address, bucket_seconds, timestamp_bucket),
    CONSTRAINT pair_snapshots_bucket CHECK (bucket_seconds IN (3600, 86400))
);

-- Price history for analytics only. NEVER an oracle: these are spot prices from
-- pool reserves, manipulable within a single transaction (llm.txt s25).
CREATE TABLE IF NOT EXISTS token_prices (
    id            BIGSERIAL   PRIMARY KEY,
    token_address TEXT        NOT NULL REFERENCES tokens(address) ON DELETE CASCADE,
    block_number  BIGINT      NOT NULL,
    timestamp     BIGINT      NOT NULL,
    price_usd     NUMERIC(38, 18) NOT NULL,
    -- How the price was derived, so an implausible number can be traced back to
    -- its route rather than guessed at (llm.txt s23).
    source        TEXT        NOT NULL,
    source_pair   TEXT,
    liquidity_usd NUMERIC(38, 18),
    CONSTRAINT token_prices_unique UNIQUE (token_address, block_number),
    CONSTRAINT token_prices_source CHECK (source IN ('STABLE_ANCHOR', 'DIRECT_STABLE', 'VIA_WKASH'))
);

COMMIT;
