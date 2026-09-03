package models

import (
	"math/big"
	"strings"
)

// NormalizeAddress lowercases an EVM address for storage.
//
// llm.txt s10 requires lowercase storage. Mixed-case (EIP-55) addresses would
// otherwise create duplicate rows for the same token, splitting its liquidity
// and volume across two identities.
func NormalizeAddress(a string) string { return strings.ToLower(strings.TrimSpace(a)) }

type Block struct {
	Number     uint64
	Hash       string
	ParentHash string
	Timestamp  uint64
}

type IndexerState struct {
	ChainID                uint64
	LastProcessedBlock     uint64
	LastProcessedBlockHash string
}

type Token struct {
	Address string
	Symbol  *string
	Name    *string
	// Nil when the decimals() call reverted. Never defaulted (llm.txt s10).
	Decimals         *int
	MetadataComplete bool
	IsWhitelisted    bool
	IsStable         bool
	IsWKASH          bool
}

type Pair struct {
	Address         string
	Token0Address   string
	Token1Address   string
	Reserve0        *big.Int
	Reserve1        *big.Int
	TotalSupply     *big.Int
	CreatedBlock    uint64
	CreatedTxHash   string
	CreatedLogIndex uint
	CreatedTimestamp uint64
	LastSyncBlock   *uint64
}

// SwapDirection is the outcome of normalising a raw Swap event (llm.txt s22).
type SwapDirection int

const (
	// DirectionUnknown means the event did not have exactly one input side.
	// Stored rather than guessed: a malformed swap must not silently contribute
	// a fabricated amount to volume.
	DirectionUnknown SwapDirection = iota
	Direction0To1
	Direction1To0
)

type Swap struct {
	ChainID     uint64
	TxHash      string
	LogIndex    uint
	BlockNumber uint64
	BlockHash   string
	Timestamp   uint64
	PairAddress string
	Sender      string
	Recipient   string

	Amount0In  *big.Int
	Amount1In  *big.Int
	Amount0Out *big.Int
	Amount1Out *big.Int

	// Normalised view. Nil when Direction is DirectionUnknown.
	Direction       SwapDirection
	TokenInAddress  *string
	TokenOutAddress *string
	AmountIn        *big.Int
	AmountOut       *big.Int

	// Nil means "no reliable price", which is NOT zero and must never be summed
	// as zero (llm.txt s23, s27).
	AmountUSD *big.Rat
}

type LiquidityEventType string

const (
	LiquidityMint LiquidityEventType = "MINT"
	LiquidityBurn LiquidityEventType = "BURN"
)

type LiquidityEvent struct {
	ChainID     uint64
	TxHash      string
	LogIndex    uint
	BlockNumber uint64
	BlockHash   string
	Timestamp   uint64
	PairAddress string
	EventType   LiquidityEventType
	Sender      *string
	Recipient   *string
	Amount0     *big.Int
	Amount1     *big.Int
	AmountUSD   *big.Rat
}

// PriceSource records how a price was derived so an implausible figure can be
// traced to its route instead of guessed at (llm.txt s23).
type PriceSource string

const (
	PriceStableAnchor PriceSource = "STABLE_ANCHOR"
	PriceDirectStable PriceSource = "DIRECT_STABLE"
	PriceViaWKASH     PriceSource = "VIA_WKASH"
)

type TokenPrice struct {
	TokenAddress string
	BlockNumber  uint64
	Timestamp    uint64
	PriceUSD     *big.Rat
	Source       PriceSource
	SourcePair   *string
	LiquidityUSD *big.Rat
}

// Bucket sizes for pair_snapshots (llm.txt s14, s35).
const (
	BucketHour = 3600
	BucketDay  = 86400
)

// FloorBucket truncates a unix timestamp to the start of its bucket.
func FloorBucket(ts uint64, bucketSeconds uint64) uint64 {
	if bucketSeconds == 0 {
		return ts
	}
	return ts - (ts % bucketSeconds)
}
