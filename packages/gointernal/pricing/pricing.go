// Package pricing derives USD prices for analytics display.
//
// ANALYTICS ONLY (llm.txt s25). These are spot prices read from pool reserves.
// They are manipulable within a single transaction by anyone willing to move a
// pool, and MUST NOT be used for lending liquidation, collateral solvency, or
// any on-chain settlement. A TWAP/oracle service is a separate future component.
package pricing

import (
	"math/big"
	"sort"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

// Pool is a priced view of one canonical pair.
type Pool struct {
	Address  string
	Token0   models.Token
	Token1   models.Token
	Reserve0 *big.Int
	Reserve1 *big.Int
}

// Price is a derived USD price plus the evidence for it.
type Price struct {
	USD          *big.Rat
	Source       models.PriceSource
	SourcePair   *string
	LiquidityUSD *big.Rat
}

// Engine prices tokens against a fixed snapshot of pools.
//
// The snapshot is explicit rather than queried lazily so that every price in one
// analytics pass is derived from the same chain state. Mixing block heights
// inside a single TVL calculation would produce a number that never actually
// existed.
type Engine struct {
	pools []Pool
	// minLiquidityUSD rejects thin pools as price sources (llm.txt s23). A pool
	// with trivial depth can be pushed to any price for the cost of a few tokens.
	minLiquidityUSD *big.Rat
}

func NewEngine(pools []Pool, minLiquidityUSD *big.Rat) *Engine {
	if minLiquidityUSD == nil {
		minLiquidityUSD = new(big.Rat)
	}
	return &Engine{pools: pools, minLiquidityUSD: minLiquidityUSD}
}

// PriceUSD resolves a token's price using the route order in llm.txt s23:
//
//	1. an approved stablecoin is worth 1 USD
//	2. a direct token/stablecoin pool
//	3. token/WKASH combined with WKASH/stablecoin
//	4. otherwise UNPRICED
//
// Returns nil when the token cannot be priced. Callers must treat that as
// "unknown", never as zero — a token silently valued at zero would understate
// TVL rather than visibly failing (llm.txt s26, s27).
func (e *Engine) PriceUSD(token models.Token) *Price {
	// Stability is an explicit, operator-set flag. llm.txt s23 forbids inferring
	// it from symbol text, because any token can call itself "USDC".
	if token.IsStable {
		one := big.NewRat(1, 1)
		return &Price{USD: one, Source: models.PriceStableAnchor}
	}

	if p := e.directStable(token); p != nil {
		return p
	}
	if p := e.viaWKASH(token); p != nil {
		return p
	}
	return nil
}

// directStable finds the deepest token/stablecoin pool that clears the liquidity
// floor and reads the price straight off its reserves.
func (e *Engine) directStable(token models.Token) *Price {
	var best *Price
	for i := range e.pools {
		p := &e.pools[i]
		other, tokenRes, otherRes, ok := counterpart(p, token.Address)
		if !ok || !other.IsStable {
			continue
		}
		price, liq, ok := ratio(token, tokenRes, other, otherRes, big.NewRat(1, 1))
		if !ok || liq.Cmp(e.minLiquidityUSD) < 0 {
			continue
		}
		if best == nil || liq.Cmp(best.LiquidityUSD) > 0 {
			addr := p.Address
			best = &Price{USD: price, Source: models.PriceDirectStable, SourcePair: &addr, LiquidityUSD: liq}
		}
	}
	return best
}

// viaWKASH prices a token through WKASH, which is itself priced against a
// stablecoin. Both legs must independently clear the liquidity floor: a deep
// WKASH/stable pool does not make a dust token/WKASH pool trustworthy.
func (e *Engine) viaWKASH(token models.Token) *Price {
	wkashPrice := e.wkashPrice()
	if wkashPrice == nil {
		return nil
	}

	var best *Price
	for i := range e.pools {
		p := &e.pools[i]
		other, tokenRes, otherRes, ok := counterpart(p, token.Address)
		if !ok || !other.IsWKASH {
			continue
		}
		price, liq, ok := ratio(token, tokenRes, other, otherRes, wkashPrice.USD)
		if !ok || liq.Cmp(e.minLiquidityUSD) < 0 {
			continue
		}
		if best == nil || liq.Cmp(best.LiquidityUSD) > 0 {
			addr := p.Address
			best = &Price{USD: price, Source: models.PriceViaWKASH, SourcePair: &addr, LiquidityUSD: liq}
		}
	}
	return best
}

// wkashPrice values WKASH from the deepest WKASH/stablecoin pool.
func (e *Engine) wkashPrice() *Price {
	for i := range e.pools {
		p := &e.pools[i]
		for _, side := range [2]models.Token{p.Token0, p.Token1} {
			if !side.IsWKASH {
				continue
			}
			if got := e.directStable(side); got != nil {
				return got
			}
		}
	}
	return nil
}

// counterpart returns the other side of a pool containing `address`, along with
// the reserves oriented as (thisToken, otherToken).
func counterpart(p *Pool, address string) (other models.Token, thisRes, otherRes *big.Int, ok bool) {
	switch address {
	case p.Token0.Address:
		return p.Token1, p.Reserve0, p.Reserve1, true
	case p.Token1.Address:
		return p.Token0, p.Reserve1, p.Reserve0, true
	}
	return models.Token{}, nil, nil, false
}

// ratio converts two raw reserves into a price and a pool-depth estimate.
//
// price = (otherHuman / thisHuman) * otherPriceUSD
// liquidity = 2 * otherHuman * otherPriceUSD
//
// Depth is measured from the side whose USD value is already known and doubled,
// which is the standard constant-product approximation: at equilibrium both
// sides hold equal value.
func ratio(
	this models.Token, thisRes *big.Int,
	other models.Token, otherRes *big.Int,
	otherPriceUSD *big.Rat,
) (price, liquidityUSD *big.Rat, ok bool) {
	thisHuman, ok1 := models.ScaleDown(thisRes, this.Decimals)
	otherHuman, ok2 := models.ScaleDown(otherRes, other.Decimals)
	// Unknown decimals on either side makes the ratio meaningless (llm.txt s10).
	if !ok1 || !ok2 {
		return nil, nil, false
	}
	if thisHuman.Sign() <= 0 || otherHuman.Sign() <= 0 {
		return nil, nil, false
	}

	otherValue := new(big.Rat).Mul(otherHuman, otherPriceUSD)
	price = new(big.Rat).Mul(new(big.Rat).Quo(otherValue, thisHuman), big.NewRat(1, 1))
	liquidityUSD = new(big.Rat).Mul(otherValue, big.NewRat(2, 1))
	return price, liquidityUSD, true
}

// SortPoolsByAddress gives the engine a deterministic iteration order, so equal
// depth ties resolve the same way on every run.
func SortPoolsByAddress(pools []Pool) {
	sort.Slice(pools, func(i, j int) bool { return pools[i].Address < pools[j].Address })
}
