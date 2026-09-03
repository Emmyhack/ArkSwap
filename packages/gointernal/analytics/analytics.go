// Package analytics derives TVL, volume and fee estimates from priced pool state.
//
// Everything here is pure arithmetic over exact rationals so the numbers can be
// unit-tested against the worked examples in llm.txt.
package analytics

import (
	"math/big"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

// FeeNumerator/FeeDenominator encode ArkSwap's 0.30% trade fee. Pinned by the
// contracts; a change is a protocol-level change (llm.txt s28).
var (
	FeeRate = big.NewRat(3, 1000)
	// DaysPerYear for the APR extrapolation.
	DaysPerYear = big.NewRat(365, 1)
)

// PairTVL computes reserve0*price0 + reserve1*price1 (llm.txt s26).
//
// Returns nil when either side cannot be priced or scaled. A partial TVL that
// counted only the priced half would look plausible and be wrong by exactly the
// value of the other side, so it is not reported at all.
func PairTVL(
	reserve0 *big.Int, token0 models.Token, price0 *big.Rat,
	reserve1 *big.Int, token1 models.Token, price1 *big.Rat,
) *big.Rat {
	if price0 == nil || price1 == nil {
		return nil
	}
	h0, ok0 := models.ScaleDown(reserve0, token0.Decimals)
	h1, ok1 := models.ScaleDown(reserve1, token1.Decimals)
	if !ok0 || !ok1 {
		return nil
	}
	return new(big.Rat).Add(new(big.Rat).Mul(h0, price0), new(big.Rat).Mul(h1, price1))
}

// SwapVolumeUSD values a swap from ONE side only (llm.txt s27).
//
// A $100 trade must contribute about $100 to volume, not $200. Adding both legs
// is the classic way DEX dashboards end up reporting double the real figure, so
// the input side is preferred and the output side is only a fallback when the
// input token has no reliable price.
//
// Returns nil when neither side can be priced. nil means "unknown" and must not
// be summed as zero.
func SwapVolumeUSD(
	tokenIn models.Token, amountIn *big.Int, priceIn *big.Rat,
	tokenOut models.Token, amountOut *big.Int, priceOut *big.Rat,
) *big.Rat {
	if priceIn != nil {
		if h, ok := models.ScaleDown(amountIn, tokenIn.Decimals); ok {
			return new(big.Rat).Mul(h, priceIn)
		}
	}
	if priceOut != nil {
		if h, ok := models.ScaleDown(amountOut, tokenOut.Decimals); ok {
			return new(big.Rat).Mul(h, priceOut)
		}
	}
	return nil
}

// EstimatedFeesUSD applies the 0.30% trade fee to a volume figure (llm.txt s28).
// Exposed to clients as an ESTIMATE: it assumes every swap paid the standard fee.
func EstimatedFeesUSD(volumeUSD *big.Rat) *big.Rat {
	if volumeUSD == nil {
		return nil
	}
	return new(big.Rat).Mul(volumeUSD, FeeRate)
}

// EstimatedAPRPercent extrapolates 24h fees over a year against current TVL
// (llm.txt s28).
//
// Returns nil for a zero or unknown TVL rather than dividing by zero. Always
// presented to users as an estimate: it assumes today's volume repeats daily.
func EstimatedAPRPercent(fees24hUSD, tvlUSD *big.Rat) *big.Rat {
	if fees24hUSD == nil || tvlUSD == nil || tvlUSD.Sign() <= 0 {
		return nil
	}
	annual := new(big.Rat).Mul(fees24hUSD, DaysPerYear)
	ratio := new(big.Rat).Quo(annual, tvlUSD)
	return ratio.Mul(ratio, big.NewRat(100, 1))
}

// SumUSD adds values, skipping unknowns.
//
// Skipping rather than zero-filling keeps "we could not price this pool" from
// masquerading as "this pool is worth nothing"; callers that care about
// completeness track the skipped count separately.
func SumUSD(values []*big.Rat) (total *big.Rat, counted, skipped int) {
	total = new(big.Rat)
	for _, v := range values {
		if v == nil {
			skipped++
			continue
		}
		total.Add(total, v)
		counted++
	}
	return total, counted, skipped
}
