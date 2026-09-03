// Package models holds the domain types shared by the indexer and the API.
package models

import (
	"fmt"
	"math/big"
	"strings"
)

// USD_SCALE is the number of decimal places used when serialising USD values.
// Wide enough that a 6-decimal stablecoin amount survives a price multiplication
// without losing significance.
const USD_SCALE = 18

// Rat is exact rational arithmetic. Every USD figure in ArkSwap analytics is a
// big.Rat rather than a float64.
//
// llm.txt s5 forbids float64 for ERC-20 amounts, and the same reasoning applies
// to the values derived from them: a TVL that is wrong in the twelfth digit is
// indistinguishable from one that is right, so the error would never be noticed.
// big.Rat multiplies and divides without rounding at all; rounding happens once,
// at the API boundary, in FormatUSD.
type Rat = big.Rat

// NewRatFromInt lifts a raw token amount into exact rational arithmetic.
func NewRatFromInt(i *big.Int) *big.Rat {
	if i == nil {
		return new(big.Rat)
	}
	return new(big.Rat).SetInt(i)
}

// ScaleDown converts a raw token amount into human units by dividing by
// 10**decimals, exactly.
//
// Returns (nil, false) when decimals are unknown. llm.txt s10 is explicit that an
// unknown token must not be silently assumed to have 18 decimals: doing so would
// misprice it by orders of magnitude and quietly corrupt TVL and volume.
func ScaleDown(raw *big.Int, decimals *int) (*big.Rat, bool) {
	if raw == nil || decimals == nil || *decimals < 0 {
		return nil, false
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(*decimals)), nil)
	return new(big.Rat).SetFrac(raw, scale), true
}

// FormatUSD renders a USD value as a fixed-point decimal string.
//
// The API returns money as strings (llm.txt s31) so a JSON consumer cannot
// silently truncate it to a float64.
func FormatUSD(r *big.Rat) string {
	if r == nil {
		return "0"
	}
	return trimZeros(r.FloatString(USD_SCALE))
}

// FormatAmount renders an exact token amount as a decimal string.
func FormatAmount(r *big.Rat, decimals int) string {
	if r == nil {
		return "0"
	}
	if decimals < 0 {
		decimals = 0
	}
	return trimZeros(r.FloatString(decimals))
}

// trimZeros drops trailing fractional zeros without changing the value, so
// "1.500000" becomes "1.5" and "2.000000" becomes "2".
func trimZeros(s string) string {
	if !strings.Contains(s, ".") {
		return s
	}
	s = strings.TrimRight(s, "0")
	return strings.TrimSuffix(s, ".")
}

// ParseBigInt reads a NUMERIC column value into a big.Int.
func ParseBigInt(s string) (*big.Int, error) {
	if s == "" {
		return big.NewInt(0), nil
	}
	// NUMERIC(78,0) round-trips as an integer string, but tolerate a ".0" tail.
	if i := strings.IndexByte(s, '.'); i >= 0 {
		s = s[:i]
	}
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return nil, fmt.Errorf("models: %q is not an integer", s)
	}
	return v, nil
}
