// Package contracts exposes the ArkSwap ABIs and event decoders.
package contracts

import (
	_ "embed"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

// The ABIs are copies of packages/abis, which scripts/generate-abis.mjs
// generates from the compiled Foundry artifacts. llm.txt s6 and s66 forbid
// hand-writing event signatures, and TestABIsMatchGeneratedPackage guards the
// copies against drift.
//
//go:embed ArkSwapFactory.json
var factoryABIJSON []byte

//go:embed ArkSwapPair.json
var pairABIJSON []byte

//go:embed ERC20.json
var erc20ABIJSON []byte

var (
	FactoryABI abi.ABI
	PairABI    abi.ABI
	ERC20ABI   abi.ABI
)

// Event topic0 values, derived from the parsed ABI rather than typed out.
var (
	TopicPairCreated common.Hash
	TopicMint        common.Hash
	TopicBurn        common.Hash
	TopicSwap        common.Hash
	TopicSync        common.Hash
)

func init() {
	var err error
	if FactoryABI, err = abi.JSON(strings.NewReader(string(factoryABIJSON))); err != nil {
		panic(fmt.Sprintf("contracts: factory ABI: %v", err))
	}
	if PairABI, err = abi.JSON(strings.NewReader(string(pairABIJSON))); err != nil {
		panic(fmt.Sprintf("contracts: pair ABI: %v", err))
	}
	if ERC20ABI, err = abi.JSON(strings.NewReader(string(erc20ABIJSON))); err != nil {
		panic(fmt.Sprintf("contracts: erc20 ABI: %v", err))
	}
	TopicPairCreated = FactoryABI.Events["PairCreated"].ID
	TopicMint = PairABI.Events["Mint"].ID
	TopicBurn = PairABI.Events["Burn"].ID
	TopicSwap = PairABI.Events["Swap"].ID
	TopicSync = PairABI.Events["Sync"].ID
}

// PairCreated is the decoded factory event.
type PairCreated struct {
	Token0 common.Address
	Token1 common.Address
	Pair   common.Address
	Index  *big.Int
}

// DecodePairCreated reads a PairCreated log.
//
// token0/token1 are indexed and live in topics; pair and the running count are
// in data. Reading them from the wrong place is exactly the class of bug that
// hand-written decoding introduces, so the split follows the parsed ABI.
func DecodePairCreated(l types.Log) (*PairCreated, error) {
	if len(l.Topics) != 3 {
		return nil, fmt.Errorf("contracts: PairCreated expects 3 topics, got %d", len(l.Topics))
	}
	out := &PairCreated{
		Token0: common.BytesToAddress(l.Topics[1].Bytes()),
		Token1: common.BytesToAddress(l.Topics[2].Bytes()),
	}
	vals, err := FactoryABI.Events["PairCreated"].Inputs.NonIndexed().Unpack(l.Data)
	if err != nil {
		return nil, fmt.Errorf("contracts: PairCreated data: %w", err)
	}
	if len(vals) != 2 {
		return nil, fmt.Errorf("contracts: PairCreated expects 2 non-indexed values, got %d", len(vals))
	}
	addr, ok := vals[0].(common.Address)
	if !ok {
		return nil, fmt.Errorf("contracts: PairCreated pair is %T", vals[0])
	}
	n, ok := vals[1].(*big.Int)
	if !ok {
		return nil, fmt.Errorf("contracts: PairCreated index is %T", vals[1])
	}
	out.Pair, out.Index = addr, n
	return out, nil
}

// SwapEvent is the decoded pair Swap event.
type SwapEvent struct {
	Sender     common.Address
	To         common.Address
	Amount0In  *big.Int
	Amount1In  *big.Int
	Amount0Out *big.Int
	Amount1Out *big.Int
}

func DecodeSwap(l types.Log) (*SwapEvent, error) {
	if len(l.Topics) != 3 {
		return nil, fmt.Errorf("contracts: Swap expects 3 topics, got %d", len(l.Topics))
	}
	vals, err := PairABI.Events["Swap"].Inputs.NonIndexed().Unpack(l.Data)
	if err != nil {
		return nil, fmt.Errorf("contracts: Swap data: %w", err)
	}
	if len(vals) != 4 {
		return nil, fmt.Errorf("contracts: Swap expects 4 non-indexed values, got %d", len(vals))
	}
	amounts := make([]*big.Int, 4)
	for i, v := range vals {
		n, ok := v.(*big.Int)
		if !ok {
			return nil, fmt.Errorf("contracts: Swap amount %d is %T", i, v)
		}
		amounts[i] = n
	}
	return &SwapEvent{
		Sender:     common.BytesToAddress(l.Topics[1].Bytes()),
		To:         common.BytesToAddress(l.Topics[2].Bytes()),
		Amount0In:  amounts[0],
		Amount1In:  amounts[1],
		Amount0Out: amounts[2],
		Amount1Out: amounts[3],
	}, nil
}

// SyncEvent carries the pair's authoritative reserves (llm.txt s21).
type SyncEvent struct {
	Reserve0 *big.Int
	Reserve1 *big.Int
}

func DecodeSync(l types.Log) (*SyncEvent, error) {
	vals, err := PairABI.Events["Sync"].Inputs.NonIndexed().Unpack(l.Data)
	if err != nil {
		return nil, fmt.Errorf("contracts: Sync data: %w", err)
	}
	if len(vals) != 2 {
		return nil, fmt.Errorf("contracts: Sync expects 2 values, got %d", len(vals))
	}
	r0, ok0 := vals[0].(*big.Int)
	r1, ok1 := vals[1].(*big.Int)
	if !ok0 || !ok1 {
		return nil, fmt.Errorf("contracts: Sync reserves are %T/%T", vals[0], vals[1])
	}
	return &SyncEvent{Reserve0: r0, Reserve1: r1}, nil
}

// MintEvent / BurnEvent are the liquidity events.
type MintEvent struct {
	Sender  common.Address
	Amount0 *big.Int
	Amount1 *big.Int
}

type BurnEvent struct {
	Sender  common.Address
	To      common.Address
	Amount0 *big.Int
	Amount1 *big.Int
}

func DecodeMint(l types.Log) (*MintEvent, error) {
	if len(l.Topics) != 2 {
		return nil, fmt.Errorf("contracts: Mint expects 2 topics, got %d", len(l.Topics))
	}
	vals, err := PairABI.Events["Mint"].Inputs.NonIndexed().Unpack(l.Data)
	if err != nil {
		return nil, fmt.Errorf("contracts: Mint data: %w", err)
	}
	if len(vals) != 2 {
		return nil, fmt.Errorf("contracts: Mint expects 2 values, got %d", len(vals))
	}
	a0, _ := vals[0].(*big.Int)
	a1, _ := vals[1].(*big.Int)
	if a0 == nil || a1 == nil {
		return nil, fmt.Errorf("contracts: Mint amounts malformed")
	}
	return &MintEvent{Sender: common.BytesToAddress(l.Topics[1].Bytes()), Amount0: a0, Amount1: a1}, nil
}

func DecodeBurn(l types.Log) (*BurnEvent, error) {
	if len(l.Topics) != 3 {
		return nil, fmt.Errorf("contracts: Burn expects 3 topics, got %d", len(l.Topics))
	}
	vals, err := PairABI.Events["Burn"].Inputs.NonIndexed().Unpack(l.Data)
	if err != nil {
		return nil, fmt.Errorf("contracts: Burn data: %w", err)
	}
	if len(vals) != 2 {
		return nil, fmt.Errorf("contracts: Burn expects 2 values, got %d", len(vals))
	}
	a0, _ := vals[0].(*big.Int)
	a1, _ := vals[1].(*big.Int)
	if a0 == nil || a1 == nil {
		return nil, fmt.Errorf("contracts: Burn amounts malformed")
	}
	return &BurnEvent{
		Sender:  common.BytesToAddress(l.Topics[1].Bytes()),
		To:      common.BytesToAddress(l.Topics[2].Bytes()),
		Amount0: a0, Amount1: a1,
	}, nil
}

// EventSignature is exported for tests that assert topic0 values independently.
func EventSignature(sig string) common.Hash {
	return crypto.Keccak256Hash([]byte(sig))
}
