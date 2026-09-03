package models

import (
	"math/big"
	"testing"
)

func intPtr(i int) *int { return &i }

func TestScaleDownUsesTokenDecimals(t *testing.T) {
	// 1 WKASH at 18 decimals, and 1 mUSDC at 6 — the two decimal layouts that
	// actually exist in the ArkSwap devnet deployment.
	raw18, _ := new(big.Int).SetString("1000000000000000000", 10)
	got, ok := ScaleDown(raw18, intPtr(18))
	if !ok || got.Cmp(big.NewRat(1, 1)) != 0 {
		t.Fatalf("18dp: got %v ok=%v, want 1", got, ok)
	}

	raw6 := big.NewInt(1_000_000)
	got, ok = ScaleDown(raw6, intPtr(6))
	if !ok || got.Cmp(big.NewRat(1, 1)) != 0 {
		t.Fatalf("6dp: got %v ok=%v, want 1", got, ok)
	}
}

// llm.txt s10: unknown decimals must not be assumed to be 18.
func TestScaleDownRefusesUnknownDecimals(t *testing.T) {
	if _, ok := ScaleDown(big.NewInt(1), nil); ok {
		t.Fatal("ScaleDown accepted a token with unknown decimals; it must refuse")
	}
}

func TestScaleDownIsExact(t *testing.T) {
	// A value chosen so binary floating point could not represent it exactly.
	raw, _ := new(big.Int).SetString("123456789012345678", 10)
	got, ok := ScaleDown(raw, intPtr(18))
	if !ok {
		t.Fatal("ScaleDown failed")
	}
	if want := "0.123456789012345678"; got.FloatString(18) != want {
		t.Fatalf("got %s, want %s", got.FloatString(18), want)
	}
}

func TestFormatUSDTrimsWithoutLosingValue(t *testing.T) {
	cases := []struct {
		in   *big.Rat
		want string
	}{
		{big.NewRat(3, 2), "1.5"},
		{big.NewRat(2, 1), "2"},
		{new(big.Rat), "0"},
		{big.NewRat(1, 3), "0.333333333333333333"},
	}
	for _, c := range cases {
		if got := FormatUSD(c.in); got != c.want {
			t.Errorf("FormatUSD(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseBigIntRoundTripsNumeric(t *testing.T) {
	for _, s := range []string{"0", "1000000000000000000", "115792089237316195423570985008687907853269984665640564039457584007913129639935"} {
		v, err := ParseBigInt(s)
		if err != nil {
			t.Fatalf("ParseBigInt(%q): %v", s, err)
		}
		if v.String() != s {
			t.Fatalf("round trip: got %s want %s", v.String(), s)
		}
	}
	if _, err := ParseBigInt("not-a-number"); err == nil {
		t.Fatal("expected an error for a non-numeric value")
	}
}
