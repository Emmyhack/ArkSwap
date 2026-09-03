package config

import (
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadReadsTheRealDeploymentManifest(t *testing.T) {
	// The committed manifest is the canonical address record; the backend must
	// pick addresses up from it rather than having them pasted into env files.
	path := filepath.Join("..", "..", "addresses", "ark-devnet.json")
	m, err := LoadManifest(path)
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}
	if m.EVMChainID != "9000" {
		t.Fatalf("chain id = %q, want 9000", m.EVMChainID)
	}
	if m.Factory == "" || m.WKASH == "" {
		t.Fatalf("manifest is missing factory/wkash: %+v", m)
	}
	usdc, ok := m.Tokens["mUSDC"]
	if !ok {
		t.Fatalf("manifest tokens missing mUSDC: %+v", m.Tokens)
	}
	if usdc.Decimals != 6 || !usdc.IsStable {
		t.Fatalf("mUSDC metadata wrong: %+v", usdc)
	}
	// A non-stable asset must not be picked up as a USD anchor.
	wbtc, ok := m.Tokens["mWBTC"]
	if !ok {
		t.Fatalf("manifest tokens missing mWBTC")
	}
	if wbtc.Decimals != 8 {
		t.Fatalf("mWBTC decimals = %d, want 8", wbtc.Decimals)
	}
	if wbtc.IsStable {
		t.Fatal("mWBTC must not be marked stable")
	}
}

func TestValidateForIndexerRejectsGenesisScan(t *testing.T) {
	c := &Config{
		ChainID:        9000,
		RPCURL:         "https://example.invalid",
		FactoryAddress: "0x594f74adca63af06d10ee06fee8f237dbb560e06",
		WKASHAddress:   "0x6792d2fd02d8a55c543f627d0e90526f9278c6d6",
		DatabaseURL:    "postgres://x",
		BlockBatchSize: 2000,
		// FactoryDeployBlock deliberately left at 0.
	}
	if err := c.ValidateForIndexer(); err == nil {
		t.Fatal("expected an error when the factory deployment block is unset")
	}
}

func TestValidateForIndexerRejectsBadAddress(t *testing.T) {
	c := &Config{
		ChainID: 9000, RPCURL: "https://example.invalid",
		FactoryAddress: "not-an-address", WKASHAddress: "0x6792d2fd02d8a55c543f627d0e90526f9278c6d6",
		FactoryDeployBlock: 1, DatabaseURL: "postgres://x", BlockBatchSize: 2000,
	}
	if err := c.ValidateForIndexer(); err == nil {
		t.Fatal("expected an error for a malformed factory address")
	}
}

// llm.txt s44: wildcard CORS must require an explicit decision, so it can never
// be reached by simply leaving a variable unset.
func TestValidateForAPIRejectsWildcardCORS(t *testing.T) {
	c := &Config{ChainID: 9000, DatabaseURL: "postgres://x", AllowedOrigins: []string{"*"}}
	if err := c.ValidateForAPI(); err == nil {
		t.Fatal("expected wildcard CORS to be rejected")
	}
}

func TestEnvOverridesManifest(t *testing.T) {
	t.Setenv("ARK_EVM_CHAIN_ID", "31337")
	t.Setenv("ARKSWAP_FACTORY_ADDRESS", "0x1111111111111111111111111111111111111111")
	t.Setenv("MIN_PRICE_LIQUIDITY_USD", "2500")
	c, err := Load(filepath.Join("..", "..", "addresses", "ark-devnet.json"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.ChainID != 31337 {
		t.Fatalf("chain id = %d, want the env override 31337", c.ChainID)
	}
	if c.FactoryAddress != "0x1111111111111111111111111111111111111111" {
		t.Fatalf("factory = %s, want the env override", c.FactoryAddress)
	}
	if c.MinPriceLiquidityUSD.Cmp(big.NewRat(2500, 1)) != 0 {
		t.Fatalf("min liquidity = %v, want 2500", c.MinPriceLiquidityUSD)
	}
}

func TestLoadRejectsNonNumericChainID(t *testing.T) {
	t.Setenv("ARK_EVM_CHAIN_ID", "mainnet")
	if _, err := Load(""); err == nil {
		t.Fatal("expected a non-numeric chain id to be rejected")
	}
	os.Unsetenv("ARK_EVM_CHAIN_ID")
}

// Only tokens explicitly flagged in the manifest may act as USD anchors.
// Picking up every listed token would make mWBTC worth $1 and corrupt TVL.
func TestOnlyFlaggedTokensBecomeStablecoins(t *testing.T) {
	c, err := Load(filepath.Join("..", "..", "addresses", "ark-devnet.json"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	m, err := LoadManifest(filepath.Join("..", "..", "addresses", "ark-devnet.json"))
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}

	stable := map[string]bool{}
	for _, a := range c.StablecoinAddresses {
		stable[a] = true
	}
	for sym, tk := range m.Tokens {
		want := tk.IsStable
		got := stable[strings.ToLower(tk.Address)]
		if got != want {
			t.Errorf("%s: treated as stablecoin=%v, manifest says isStable=%v", sym, got, want)
		}
	}
	if len(c.StablecoinAddresses) == 0 {
		t.Fatal("no stablecoins configured; pricing would have no USD anchor")
	}
}
