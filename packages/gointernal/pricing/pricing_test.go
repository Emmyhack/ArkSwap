package pricing

import (
	"math/big"
	"testing"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

func dp(i int) *int { return &i }

func tok(addr string, dec int, opts ...func(*models.Token)) models.Token {
	t := models.Token{Address: addr, Decimals: dp(dec), MetadataComplete: true}
	for _, o := range opts {
		o(&t)
	}
	return t
}

func stable(t *models.Token)  { t.IsStable = true }
func wkashFlag(t *models.Token) { t.IsWKASH = true }

func units(n string, decimals int) *big.Int {
	v, _ := new(big.Int).SetString(n, 10)
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	return v.Mul(v, scale)
}

var (
	wkash = tok("0xwkash", 18, wkashFlag)
	usdc  = tok("0xusdc", 6, stable)
	dust  = tok("0xdust", 18)
)

// llm.txt s24: 100,000 WKASH against 300,000 USDC implies WKASH ~= $3.
func TestWKASHPricedFromStablePool(t *testing.T) {
	e := NewEngine([]Pool{{
		Address: "0xpool", Token0: wkash, Token1: usdc,
		Reserve0: units("100000", 18), Reserve1: units("300000", 6),
	}}, big.NewRat(1000, 1))

	p := e.PriceUSD(wkash)
	if p == nil {
		t.Fatal("WKASH could not be priced")
	}
	if p.USD.Cmp(big.NewRat(3, 1)) != 0 {
		t.Fatalf("WKASH price = %s, want 3", p.USD.FloatString(6))
	}
	if p.Source != models.PriceDirectStable {
		t.Fatalf("source = %v, want DIRECT_STABLE", p.Source)
	}
	// Depth is both sides: 300k USDC doubled.
	if p.LiquidityUSD.Cmp(big.NewRat(600000, 1)) != 0 {
		t.Fatalf("liquidity = %s, want 600000", p.LiquidityUSD.FloatString(2))
	}
}

// An approved stablecoin anchors at exactly 1 USD without consulting any pool.
func TestStablecoinAnchorsAtOne(t *testing.T) {
	e := NewEngine(nil, big.NewRat(1000, 1))
	p := e.PriceUSD(usdc)
	if p == nil || p.USD.Cmp(big.NewRat(1, 1)) != 0 || p.Source != models.PriceStableAnchor {
		t.Fatalf("stable anchor = %+v", p)
	}
}

// llm.txt s23: a pool below MIN_PRICE_LIQUIDITY_USD must be rejected outright,
// not used with a caveat. Thin pools are exactly what price manipulation uses.
func TestThinPoolIsRejected(t *testing.T) {
	e := NewEngine([]Pool{{
		Address: "0xthin", Token0: wkash, Token1: usdc,
		Reserve0: units("1", 18), Reserve1: units("3", 6), // $6 of depth
	}}, big.NewRat(1000, 1))

	if p := e.PriceUSD(wkash); p != nil {
		t.Fatalf("thin pool was used as a price source: %+v", p)
	}
}

// Route 3: a token with no stable pair is priced through WKASH.
func TestTokenPricedViaWKASH(t *testing.T) {
	e := NewEngine([]Pool{
		{Address: "0xwkusdc", Token0: wkash, Token1: usdc,
			Reserve0: units("100000", 18), Reserve1: units("300000", 6)},
		// 1000 DUST : 2000 WKASH  ->  1 DUST = 2 WKASH = $6
		{Address: "0xdustwk", Token0: dust, Token1: wkash,
			Reserve0: units("1000", 18), Reserve1: units("2000", 18)},
	}, big.NewRat(1000, 1))

	p := e.PriceUSD(dust)
	if p == nil {
		t.Fatal("DUST could not be priced via WKASH")
	}
	if p.USD.Cmp(big.NewRat(6, 1)) != 0 {
		t.Fatalf("DUST price = %s, want 6", p.USD.FloatString(6))
	}
	if p.Source != models.PriceViaWKASH {
		t.Fatalf("source = %v, want VIA_WKASH", p.Source)
	}
}

// Route 4: no eligible route means UNPRICED, never a fabricated zero.
func TestUnpricedTokenReturnsNil(t *testing.T) {
	e := NewEngine([]Pool{{
		Address: "0xorphan", Token0: dust, Token1: tok("0xother", 18),
		Reserve0: units("1000", 18), Reserve1: units("1000", 18),
	}}, big.NewRat(1000, 1))

	if p := e.PriceUSD(dust); p != nil {
		t.Fatalf("expected UNPRICED, got %+v", p)
	}
}

// Deepest eligible pool wins when several are available (llm.txt s23).
func TestDeepestPoolWins(t *testing.T) {
	e := NewEngine([]Pool{
		{Address: "0xshallow", Token0: wkash, Token1: usdc,
			Reserve0: units("1000", 18), Reserve1: units("1000", 6)}, // $1
		{Address: "0xdeep", Token0: wkash, Token1: usdc,
			Reserve0: units("100000", 18), Reserve1: units("300000", 6)}, // $3
	}, big.NewRat(1000, 1))

	p := e.PriceUSD(wkash)
	if p == nil || p.USD.Cmp(big.NewRat(3, 1)) != 0 {
		t.Fatalf("expected the deeper pool's price of 3, got %+v", p)
	}
	if p.SourcePair == nil || *p.SourcePair != "0xdeep" {
		t.Fatalf("source pair = %v, want 0xdeep", p.SourcePair)
	}
}

// A token whose decimals() reverted cannot be priced: scaling it would be a
// guess (llm.txt s10).
func TestUnknownDecimalsBlocksPricing(t *testing.T) {
	mystery := models.Token{Address: "0xmystery", Decimals: nil}
	e := NewEngine([]Pool{{
		Address: "0xp", Token0: mystery, Token1: usdc,
		Reserve0: units("1000", 18), Reserve1: units("100000", 6),
	}}, big.NewRat(1000, 1))

	if p := e.PriceUSD(mystery); p != nil {
		t.Fatalf("priced a token with unknown decimals: %+v", p)
	}
}
