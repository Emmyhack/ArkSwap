package config

import (
	"math/big"
	"os"
	"path/filepath"
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
	if _, ok := m.Tokens["mUSDC"]; !ok {
		t.Fatalf("manifest tokens missing mUSDC: %+v", m.Tokens)
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
