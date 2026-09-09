package chain

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/contracts"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

// Client is a retrying, timeout-bounded view of the Ark JSON-RPC endpoint.
//
// Read-only by construction: it holds no keys and exposes no way to sign or send
// a transaction. The analytics backend must never sit on the swap path
// (llm.txt s0, s62), and the simplest guarantee of that is a client that cannot
// transact at all.
type Client struct {
	ec         *ethclient.Client
	timeout    time.Duration
	maxRetries int
	log        *slog.Logger
}

func Dial(ctx context.Context, rpcURL string, timeout time.Duration, maxRetries int, log *slog.Logger) (*Client, error) {
	ec, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return nil, fmt.Errorf("chain: dialing RPC: %w", err)
	}
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	if maxRetries < 1 {
		maxRetries = 5
	}
	return &Client{ec: ec, timeout: timeout, maxRetries: maxRetries, log: log}, nil
}

func (c *Client) Close() { c.ec.Close() }

func (c *Client) call(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, c.timeout)
}

// ChainID reports the connected chain.
func (c *Client) ChainID(ctx context.Context) (uint64, error) {
	return retry(ctx, c.maxRetries, func(ctx context.Context) (uint64, error) {
		cctx, cancel := c.call(ctx)
		defer cancel()
		id, err := c.ec.ChainID(cctx)
		if err != nil {
			return 0, err
		}
		return id.Uint64(), nil
	})
}

// BlockNumber is the current chain head.
func (c *Client) BlockNumber(ctx context.Context) (uint64, error) {
	return retry(ctx, c.maxRetries, func(ctx context.Context) (uint64, error) {
		cctx, cancel := c.call(ctx)
		defer cancel()
		return c.ec.BlockNumber(cctx)
	})
}

// HeaderByNumber fetches one block header, which carries the hash and parent
// hash the reorg check compares (llm.txt s19).
func (c *Client) HeaderByNumber(ctx context.Context, number uint64) (*models.Block, error) {
	h, err := retry(ctx, c.maxRetries, func(ctx context.Context) (*types.Header, error) {
		cctx, cancel := c.call(ctx)
		defer cancel()
		return c.ec.HeaderByNumber(cctx, new(big.Int).SetUint64(number))
	})
	if err != nil {
		return nil, fmt.Errorf("chain: header %d: %w", number, err)
	}
	return &models.Block{
		Number:     h.Number.Uint64(),
		Hash:       strings.ToLower(h.Hash().Hex()),
		ParentHash: strings.ToLower(h.ParentHash.Hex()),
		Timestamp:  h.Time,
	}, nil
}

// HasCode reports whether an address holds contract bytecode.
//
// Used to verify the factory really is deployed before indexing begins
// (llm.txt s15): pointing the indexer at a wrong or empty address would
// otherwise produce a silently empty database rather than an error.
func (c *Client) HasCode(ctx context.Context, address string) (bool, error) {
	code, err := retry(ctx, c.maxRetries, func(ctx context.Context) ([]byte, error) {
		cctx, cancel := c.call(ctx)
		defer cancel()
		return c.ec.CodeAt(cctx, common.HexToAddress(address), nil)
	})
	if err != nil {
		return false, fmt.Errorf("chain: code at %s: %w", address, err)
	}
	return len(code) > 0, nil
}

// FilterLogs fetches logs for a block range.
func (c *Client) FilterLogs(ctx context.Context, from, to uint64, addresses []common.Address, topics [][]common.Hash) ([]types.Log, error) {
	return retry(ctx, c.maxRetries, func(ctx context.Context) ([]types.Log, error) {
		cctx, cancel := c.call(ctx)
		defer cancel()
		return c.ec.FilterLogs(cctx, ethereum.FilterQuery{
			FromBlock: new(big.Int).SetUint64(from),
			ToBlock:   new(big.Int).SetUint64(to),
			Addresses: addresses,
			Topics:    topics,
		})
	})
}

// RangeTooLarge reports whether an error means the node refused the block span,
// as opposed to failing for some other reason.
//
// Nodes disagree on both the limit and the wording, so the caller halves its
// batch and retries rather than trying to parse a specific limit out of the
// message (llm.txt s16).
func RangeTooLarge(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	for _, needle := range []string{
		"query returned more than",
		"exceeds the limit",
		"block range is too wide",
		"too many results",
		"limit exceeded",
		"range too large",
		"response size exceeded",
	} {
		if strings.Contains(s, needle) {
			return true
		}
	}
	return false
}

// callContract performs one eth_call.
func (c *Client) callContract(ctx context.Context, to string, data []byte) ([]byte, error) {
	addr := common.HexToAddress(to)
	return retry(ctx, c.maxRetries, func(ctx context.Context) ([]byte, error) {
		cctx, cancel := c.call(ctx)
		defer cancel()
		return c.ec.CallContract(cctx, ethereum.CallMsg{To: &addr, Data: data}, nil)
	})
}

// PairReserves reads a pair's authoritative reserves, used by reconciliation
// to compare indexed state against the chain (llm.txt s41).
func (c *Client) PairReserves(ctx context.Context, pair string) (r0, r1 *big.Int, err error) {
	data, err := contracts.PairABI.Pack("getReserves")
	if err != nil {
		return nil, nil, err
	}
	out, err := c.callContract(ctx, pair, data)
	if err != nil {
		return nil, nil, fmt.Errorf("chain: getReserves %s: %w", pair, err)
	}
	vals, err := contracts.PairABI.Unpack("getReserves", out)
	if err != nil || len(vals) < 2 {
		return nil, nil, fmt.Errorf("chain: decoding getReserves %s: %w", pair, err)
	}
	r0, _ = vals[0].(*big.Int)
	r1, _ = vals[1].(*big.Int)
	if r0 == nil || r1 == nil {
		return nil, nil, fmt.Errorf("chain: getReserves %s returned unexpected types", pair)
	}
	return r0, r1, nil
}

// PairTotalSupply reads a pair's LP token supply.
func (c *Client) PairTotalSupply(ctx context.Context, pair string) (*big.Int, error) {
	data, err := contracts.PairABI.Pack("totalSupply")
	if err != nil {
		return nil, err
	}
	out, err := c.callContract(ctx, pair, data)
	if err != nil {
		return nil, fmt.Errorf("chain: totalSupply %s: %w", pair, err)
	}
	vals, err := contracts.PairABI.Unpack("totalSupply", out)
	if err != nil || len(vals) < 1 {
		return nil, fmt.Errorf("chain: decoding totalSupply %s: %w", pair, err)
	}
	v, _ := vals[0].(*big.Int)
	if v == nil {
		return nil, fmt.Errorf("chain: totalSupply %s returned unexpected type", pair)
	}
	return v, nil
}

// FactoryPairCount reads allPairsLength(), which reconciliation compares against
// the number of indexed pairs (llm.txt s41).
func (c *Client) FactoryPairCount(ctx context.Context, factory string) (uint64, error) {
	data, err := contracts.FactoryABI.Pack("allPairsLength")
	if err != nil {
		return 0, err
	}
	out, err := c.callContract(ctx, factory, data)
	if err != nil {
		return 0, fmt.Errorf("chain: allPairsLength: %w", err)
	}
	vals, err := contracts.FactoryABI.Unpack("allPairsLength", out)
	if err != nil || len(vals) < 1 {
		return 0, fmt.Errorf("chain: decoding allPairsLength: %w", err)
	}
	v, _ := vals[0].(*big.Int)
	if v == nil {
		return 0, fmt.Errorf("chain: allPairsLength returned unexpected type")
	}
	return v.Uint64(), nil
}
