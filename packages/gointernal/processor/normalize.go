// Package processor turns raw chain events into the normalised rows the
// analytics layer consumes. Everything here is pure: no database, no RPC.
package processor

import (
	"math/big"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

// NormalizeSwap determines trade direction from a raw Uniswap V2-style Swap
// event (llm.txt s22).
//
//	amount0In > 0  ->  token0 in, token1 out
//	amount1In > 0  ->  token1 in, token0 out
//
// ABNORMAL CASES ARE NOT GUESSED. A flash swap, or a pair interacted with
// directly, can emit an event with both input sides non-zero or neither. Those
// are recorded as DirectionUnknown with nil normalised amounts, so they appear
// in swap history but contribute nothing to volume. Inventing a direction here
// would silently corrupt every volume figure downstream, which llm.txt s66 calls
// out as the thing to stop and report rather than paper over.
func NormalizeSwap(s *models.Swap, token0, token1 string) {
	zero := big.NewInt(0)
	in0 := positive(s.Amount0In, zero)
	in1 := positive(s.Amount1In, zero)

	switch {
	case in0 && !in1:
		s.Direction = models.Direction0To1
		t0, t1 := token0, token1
		s.TokenInAddress, s.TokenOutAddress = &t0, &t1
		s.AmountIn = cloneOrZero(s.Amount0In)
		s.AmountOut = cloneOrZero(s.Amount1Out)
	case in1 && !in0:
		s.Direction = models.Direction1To0
		t0, t1 := token1, token0
		s.TokenInAddress, s.TokenOutAddress = &t0, &t1
		s.AmountIn = cloneOrZero(s.Amount1In)
		s.AmountOut = cloneOrZero(s.Amount0Out)
	default:
		s.Direction = models.DirectionUnknown
		s.TokenInAddress, s.TokenOutAddress = nil, nil
		s.AmountIn, s.AmountOut = nil, nil
	}
}

func positive(v, zero *big.Int) bool { return v != nil && v.Cmp(zero) > 0 }

func cloneOrZero(v *big.Int) *big.Int {
	if v == nil {
		return big.NewInt(0)
	}
	return new(big.Int).Set(v)
}

// StableLegUSD values a swap from whichever side is an approved USD anchor.
//
// llm.txt s27 wants one side counted, never both, so a $100 trade contributes
// about $100 rather than $200. Using the stablecoin leg has a property the
// reserve-derived alternative lacks: it is exact and HISTORICAL. The swap event
// itself carries the amount that changed hands, so backfilling old blocks yields
// the value at the time of the trade rather than today's pool price applied
// retroactively.
//
// Returns nil when neither side is an anchor. nil means "unknown", which callers
// must not sum as zero (llm.txt s23).
func StableLegUSD(
	tokenIn models.Token, amountIn *big.Int,
	tokenOut models.Token, amountOut *big.Int,
) *big.Rat {
	// The input side is preferred: it is what the trader actually paid.
	if tokenIn.IsStable {
		if v, ok := models.ScaleDown(amountIn, tokenIn.Decimals); ok {
			return v
		}
	}
	if tokenOut.IsStable {
		if v, ok := models.ScaleDown(amountOut, tokenOut.Decimals); ok {
			return v
		}
	}
	return nil
}
