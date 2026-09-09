package processor

import (
	"math/big"
	"testing"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

const (
	t0 = "0x6792d2fd02d8a55c543f627d0e90526f9278c6d6" // WKASH
	t1 = "0xc8d15f9a42ee3107ab1257e38199e3bf899dcfb3" // mUSDC
)

func TestNormalizeSwapToken0In(t *testing.T) {
	s := &models.Swap{
		Amount0In:  big.NewInt(1_000_000_000_000_000_000),
		Amount1In:  big.NewInt(0),
		Amount0Out: big.NewInt(0),
		Amount1Out: big.NewInt(921_977),
	}
	NormalizeSwap(s, t0, t1)

	if s.Direction != models.Direction0To1 {
		t.Fatalf("direction = %v, want Direction0To1", s.Direction)
	}
	if *s.TokenInAddress != t0 || *s.TokenOutAddress != t1 {
		t.Fatalf("tokens = %s->%s, want %s->%s", *s.TokenInAddress, *s.TokenOutAddress, t0, t1)
	}
	if s.AmountIn.Cmp(s.Amount0In) != 0 || s.AmountOut.Cmp(s.Amount1Out) != 0 {
		t.Fatalf("amounts = %v/%v", s.AmountIn, s.AmountOut)
	}
}

func TestNormalizeSwapToken1In(t *testing.T) {
	s := &models.Swap{
		Amount0In:  big.NewInt(0),
		Amount1In:  big.NewInt(972_754),
		Amount0Out: big.NewInt(994_154_161_507_791_751),
		Amount1Out: big.NewInt(0),
	}
	NormalizeSwap(s, t0, t1)

	if s.Direction != models.Direction1To0 {
		t.Fatalf("direction = %v, want Direction1To0", s.Direction)
	}
	if *s.TokenInAddress != t1 || *s.TokenOutAddress != t0 {
		t.Fatalf("tokens = %s->%s", *s.TokenInAddress, *s.TokenOutAddress)
	}
	if s.AmountIn.Cmp(big.NewInt(972_754)) != 0 {
		t.Fatalf("amountIn = %v", s.AmountIn)
	}
}

// A malformed event must not be assigned a direction. Guessing one would feed a
// fabricated amount into volume.
func TestNormalizeSwapRefusesAmbiguousEvents(t *testing.T) {
	cases := map[string]*models.Swap{
		"both sides in": {
			Amount0In: big.NewInt(5), Amount1In: big.NewInt(7),
			Amount0Out: big.NewInt(1), Amount1Out: big.NewInt(1),
		},
		"neither side in": {
			Amount0In: big.NewInt(0), Amount1In: big.NewInt(0),
			Amount0Out: big.NewInt(0), Amount1Out: big.NewInt(0),
		},
		"nil amounts": {},
	}
	for name, s := range cases {
		NormalizeSwap(s, t0, t1)
		if s.Direction != models.DirectionUnknown {
			t.Errorf("%s: direction = %v, want DirectionUnknown", name, s.Direction)
		}
		if s.AmountIn != nil || s.AmountOut != nil || s.TokenInAddress != nil {
			t.Errorf("%s: expected nil normalised fields, got in=%v out=%v", name, s.AmountIn, s.AmountOut)
		}
	}
}

// Normalisation must not alias the raw event's big.Ints, or a later mutation of
// one would silently change the other.
func TestNormalizeSwapDoesNotAliasRawAmounts(t *testing.T) {
	s := &models.Swap{
		Amount0In: big.NewInt(100), Amount1In: big.NewInt(0),
		Amount0Out: big.NewInt(0), Amount1Out: big.NewInt(42),
	}
	NormalizeSwap(s, t0, t1)
	s.AmountIn.SetInt64(999)
	if s.Amount0In.Int64() != 100 {
		t.Fatalf("raw Amount0In was mutated to %v", s.Amount0In)
	}
}

func dp(i int) *int { return &i }

func TestStableLegUSDPrefersInputSide(t *testing.T) {
	usdc := models.Token{Address: t1, Decimals: dp(6), IsStable: true}
	wkash := models.Token{Address: t0, Decimals: dp(18)}

	// 1.5 mUSDC in -> some WKASH out. Value is the stable side: $1.50.
	got := StableLegUSD(usdc, big.NewInt(1_500_000), wkash, big.NewInt(1))
	if got == nil || got.FloatString(2) != "1.50" {
		t.Fatalf("got %v, want 1.50", got)
	}
}

func TestStableLegUSDFallsBackToOutputSide(t *testing.T) {
	usdc := models.Token{Address: t1, Decimals: dp(6), IsStable: true}
	wkash := models.Token{Address: t0, Decimals: dp(18)}

	// 1 WKASH in -> 0.972754 mUSDC out.
	amtIn, _ := new(big.Int).SetString("1000000000000000000", 10)
	got := StableLegUSD(wkash, amtIn, usdc, big.NewInt(972_754))
	if got == nil || got.FloatString(6) != "0.972754" {
		t.Fatalf("got %v, want 0.972754", got)
	}
}

// Counting both legs is the classic way a DEX dashboard reports double the real
// volume; only one side may ever be used.
func TestStableLegUSDCountsOneSideOnly(t *testing.T) {
	a := models.Token{Address: t0, Decimals: dp(6), IsStable: true}
	b := models.Token{Address: t1, Decimals: dp(6), IsStable: true}
	got := StableLegUSD(a, big.NewInt(100_000_000), b, big.NewInt(99_700_000))
	if got == nil || got.FloatString(2) != "100.00" {
		t.Fatalf("got %v, want exactly 100.00 (both sides would be ~199.70)", got)
	}
}

func TestStableLegUSDUnknownWhenNoAnchor(t *testing.T) {
	a := models.Token{Address: t0, Decimals: dp(18)}
	b := models.Token{Address: t1, Decimals: dp(8)}
	if got := StableLegUSD(a, big.NewInt(1), b, big.NewInt(1)); got != nil {
		t.Fatalf("expected nil for a swap with no stable leg, got %v", got)
	}
}
