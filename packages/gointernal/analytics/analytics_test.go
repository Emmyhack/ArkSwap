package analytics

import (
	"math/big"
	"testing"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

func dp(i int) *int { return &i }

func units(n string, decimals int) *big.Int {
	v, _ := new(big.Int).SetString(n, 10)
	return v.Mul(v, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil))
}

var (
	wkash = models.Token{Address: "0xwkash", Decimals: dp(18)}
	usdc  = models.Token{Address: "0xusdc", Decimals: dp(6)}
	noDec = models.Token{Address: "0xunknown", Decimals: nil}
)

// 100 WKASH at $3 plus 300 USDC at $1 = $600.
func TestPairTVL(t *testing.T) {
	got := PairTVL(
		units("100", 18), wkash, big.NewRat(3, 1),
		units("300", 6), usdc, big.NewRat(1, 1),
	)
	if got == nil || got.Cmp(big.NewRat(600, 1)) != 0 {
		t.Fatalf("TVL = %v, want 600", got)
	}
}

func TestPairTVLUnknownWhenEitherSideUnpriced(t *testing.T) {
	if got := PairTVL(units("100", 18), wkash, nil, units("300", 6), usdc, big.NewRat(1, 1)); got != nil {
		t.Fatalf("expected nil TVL when a side is unpriced, got %v", got)
	}
	if got := PairTVL(units("1", 18), noDec, big.NewRat(1, 1), units("1", 6), usdc, big.NewRat(1, 1)); got != nil {
		t.Fatalf("expected nil TVL when decimals are unknown, got %v", got)
	}
}

// llm.txt s27: a $100 swap contributes ~$100, never $200.
func TestSwapVolumeCountsOneSideOnly(t *testing.T) {
	// 100 USDC in ($1) -> 33.33 WKASH out ($3) — both sides are worth ~$100.
	got := SwapVolumeUSD(
		usdc, units("100", 6), big.NewRat(1, 1),
		wkash, units("33", 18), big.NewRat(3, 1),
	)
	if got == nil {
		t.Fatal("volume was nil")
	}
	if got.Cmp(big.NewRat(100, 1)) != 0 {
		t.Fatalf("volume = %s, want exactly 100 (both sides would give ~199)", got.FloatString(2))
	}
}

// When the input token has no price, fall back to the output side.
func TestSwapVolumeFallsBackToOutputSide(t *testing.T) {
	got := SwapVolumeUSD(
		models.Token{Address: "0xweird", Decimals: dp(18)}, units("5", 18), nil,
		usdc, units("250", 6), big.NewRat(1, 1),
	)
	if got == nil || got.Cmp(big.NewRat(250, 1)) != 0 {
		t.Fatalf("volume = %v, want 250 from the output side", got)
	}
}

func TestSwapVolumeUnknownWhenNeitherSidePriced(t *testing.T) {
	got := SwapVolumeUSD(
		models.Token{Address: "0xa", Decimals: dp(18)}, units("5", 18), nil,
		models.Token{Address: "0xb", Decimals: dp(18)}, units("5", 18), nil,
	)
	if got != nil {
		t.Fatalf("expected nil, got %v — unknown must not become zero", got)
	}
}

func TestEstimatedFees(t *testing.T) {
	got := EstimatedFeesUSD(big.NewRat(10000, 1))
	if got.Cmp(big.NewRat(30, 1)) != 0 {
		t.Fatalf("fees = %s, want 30 (0.30%% of 10000)", got.FloatString(4))
	}
	if EstimatedFeesUSD(nil) != nil {
		t.Fatal("nil volume must give nil fees")
	}
}

// $30/day on $100,000 TVL = $10,950/yr = 10.95%.
func TestEstimatedAPR(t *testing.T) {
	got := EstimatedAPRPercent(big.NewRat(30, 1), big.NewRat(100000, 1))
	if got == nil || got.FloatString(2) != "10.95" {
		t.Fatalf("APR = %v, want 10.95", got)
	}
}

func TestEstimatedAPRGuardsZeroTVL(t *testing.T) {
	if got := EstimatedAPRPercent(big.NewRat(30, 1), new(big.Rat)); got != nil {
		t.Fatalf("expected nil APR for zero TVL, got %v", got)
	}
}

// Unknown values are skipped, not counted as zero, and the caller can see how
// many were dropped.
func TestSumUSDReportsSkipped(t *testing.T) {
	total, counted, skipped := SumUSD([]*big.Rat{big.NewRat(10, 1), nil, big.NewRat(5, 1)})
	if total.Cmp(big.NewRat(15, 1)) != 0 || counted != 2 || skipped != 1 {
		t.Fatalf("total=%v counted=%d skipped=%d", total, counted, skipped)
	}
}
