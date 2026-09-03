// Package config loads and validates runtime configuration for both Go apps.
package config

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var addressRe = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

// Config is the validated runtime configuration.
//
// llm.txt s4 and s66 are categorical: never invent Ark endpoints, chain ids or
// addresses. Everything here is either read from the environment or from the
// committed deployment manifest, and Load fails loudly rather than defaulting
// anything that could point the indexer at the wrong chain.
type Config struct {
	ChainID          uint64
	RPCURL           string
	WSURL            string
	FactoryAddress   string
	FactoryDeployBlock uint64
	WKASHAddress     string

	DatabaseURL string
	APIPort     int

	Confirmations   uint64
	BlockBatchSize  uint64
	MaxRPCRetries   int
	RPCTimeout      time.Duration
	LogLevel        string
	AllowedOrigins  []string
	MinPriceLiquidityUSD *big.Rat

	// Addresses of tokens explicitly approved as USD anchors. Never inferred
	// from symbol text (llm.txt s23).
	StablecoinAddresses []string
}

// Manifest mirrors the parts of packages/addresses/<network>.json the backend
// needs. Reading the manifest is what keeps canonical addresses from being
// duplicated by hand across web, api and indexer.
type Manifest struct {
	EVMChainID  string                 `json:"evmChainId"`
	WKASH       string                 `json:"wkash"`
	Factory     string                 `json:"factory"`
	Tokens      map[string]ManifestToken `json:"tokens"`
	RoutingHubs []string               `json:"routingHubs"`
	Deployments struct {
		FactoryBlock json.Number `json:"factoryBlock"`
	} `json:"deployments"`
}

// ManifestToken carries a listed token's metadata.
//
// IsStable travels with the deployment record rather than living in a hardcoded
// allowlist, so listing a new asset never requires a code change. llm.txt s23
// forbids inferring stability from symbol text, and a constant in this file
// would go stale the moment a token was added.
type ManifestToken struct {
	Address      string `json:"address"`
	Name         string `json:"name"`
	Decimals     int    `json:"decimals"`
	IsDevnetMock bool   `json:"isDevnetMock"`
	IsStable     bool   `json:"isStable"`
}

// LoadManifest reads a deployment manifest from packages/addresses.
func LoadManifest(path string) (*Manifest, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: reading manifest %s: %w", path, err)
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("config: parsing manifest %s: %w", path, err)
	}
	return &m, nil
}

// Load builds a Config from the environment, optionally seeded by a manifest.
//
// Environment always wins over the manifest, so a local anvil stack can be
// targeted without editing committed deployment records.
func Load(manifestPath string) (*Config, error) {
	c := &Config{
		APIPort:        8080,
		Confirmations:  3,
		BlockBatchSize: 2000,
		MaxRPCRetries:  5,
		RPCTimeout:     15 * time.Second,
		LogLevel:       "info",
		AllowedOrigins: []string{"http://localhost:3000"},
		MinPriceLiquidityUSD: big.NewRat(1000, 1),
	}

	var m *Manifest
	if manifestPath != "" {
		if loaded, err := LoadManifest(manifestPath); err == nil {
			m = loaded
		}
		// A missing or unreadable manifest is not fatal: every value it supplies
		// can also be set explicitly in the environment.
	}
	if m != nil {
		if v, err := strconv.ParseUint(m.EVMChainID, 10, 64); err == nil {
			c.ChainID = v
		}
		c.FactoryAddress = strings.ToLower(m.Factory)
		c.WKASHAddress = strings.ToLower(m.WKASH)
		if b, err := m.Deployments.FactoryBlock.Int64(); err == nil && b > 0 {
			c.FactoryDeployBlock = uint64(b)
		}
		// Only tokens the manifest explicitly marks stable become USD anchors.
		for _, t := range m.Tokens {
			if t.IsStable {
				c.StablecoinAddresses = append(c.StablecoinAddresses, strings.ToLower(t.Address))
			}
		}
	}

	if v := os.Getenv("ARK_EVM_CHAIN_ID"); v != "" {
		id, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("config: ARK_EVM_CHAIN_ID %q is not a number", v)
		}
		c.ChainID = id
	}
	c.RPCURL = os.Getenv("ARK_RPC_URL")
	c.WSURL = os.Getenv("ARK_WS_URL")
	if v := os.Getenv("ARKSWAP_FACTORY_ADDRESS"); v != "" {
		c.FactoryAddress = strings.ToLower(v)
	}
	if v := os.Getenv("WKASH_ADDRESS"); v != "" {
		c.WKASHAddress = strings.ToLower(v)
	}
	if v := os.Getenv("ARKSWAP_FACTORY_DEPLOYMENT_BLOCK"); v != "" {
		b, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("config: ARKSWAP_FACTORY_DEPLOYMENT_BLOCK %q is not a number", v)
		}
		c.FactoryDeployBlock = b
	}
	c.DatabaseURL = os.Getenv("DATABASE_URL")

	if err := setInt(&c.APIPort, "API_PORT"); err != nil {
		return nil, err
	}
	if err := setUint(&c.Confirmations, "INDEXER_CONFIRMATIONS"); err != nil {
		return nil, err
	}
	if err := setUint(&c.BlockBatchSize, "BLOCK_BATCH_SIZE"); err != nil {
		return nil, err
	}
	if err := setInt(&c.MaxRPCRetries, "MAX_RPC_RETRIES"); err != nil {
		return nil, err
	}
	if v := os.Getenv("RPC_TIMEOUT_SECONDS"); v != "" {
		s, err := strconv.Atoi(v)
		if err != nil || s <= 0 {
			return nil, fmt.Errorf("config: RPC_TIMEOUT_SECONDS %q is not a positive number", v)
		}
		c.RPCTimeout = time.Duration(s) * time.Second
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		c.LogLevel = strings.ToLower(v)
	}
	if v := os.Getenv("ALLOWED_ORIGINS"); v != "" {
		c.AllowedOrigins = splitCSV(v)
	}
	if v := os.Getenv("MIN_PRICE_LIQUIDITY_USD"); v != "" {
		r, ok := new(big.Rat).SetString(v)
		if !ok {
			return nil, fmt.Errorf("config: MIN_PRICE_LIQUIDITY_USD %q is not a number", v)
		}
		c.MinPriceLiquidityUSD = r
	}
	if v := os.Getenv("ARKSWAP_STABLECOINS"); v != "" {
		c.StablecoinAddresses = nil
		for _, a := range splitCSV(v) {
			c.StablecoinAddresses = append(c.StablecoinAddresses, strings.ToLower(a))
		}
	}
	return c, nil
}

// ValidateForIndexer checks everything the indexer needs before it touches the
// chain or the database.
func (c *Config) ValidateForIndexer() error {
	if c.ChainID == 0 {
		return fmt.Errorf("config: ARK_EVM_CHAIN_ID is required")
	}
	if c.RPCURL == "" {
		return fmt.Errorf("config: ARK_RPC_URL is required")
	}
	if !addressRe.MatchString(c.FactoryAddress) {
		return fmt.Errorf("config: ARKSWAP_FACTORY_ADDRESS %q is not an EVM address", c.FactoryAddress)
	}
	if !addressRe.MatchString(c.WKASHAddress) {
		return fmt.Errorf("config: WKASH_ADDRESS %q is not an EVM address", c.WKASHAddress)
	}
	// Scanning from genesis is explicitly forbidden (llm.txt s8): on a long-lived
	// chain it would take hours and index nothing useful before the factory existed.
	if c.FactoryDeployBlock == 0 {
		return fmt.Errorf("config: ARKSWAP_FACTORY_DEPLOYMENT_BLOCK is required (never scan from genesis)")
	}
	if c.DatabaseURL == "" {
		return fmt.Errorf("config: DATABASE_URL is required")
	}
	if c.BlockBatchSize == 0 {
		return fmt.Errorf("config: BLOCK_BATCH_SIZE must be > 0")
	}
	return nil
}

// ValidateForAPI checks what the read-only API needs.
func (c *Config) ValidateForAPI() error {
	if c.DatabaseURL == "" {
		return fmt.Errorf("config: DATABASE_URL is required")
	}
	if c.ChainID == 0 {
		return fmt.Errorf("config: ARK_EVM_CHAIN_ID is required")
	}
	for _, o := range c.AllowedOrigins {
		if o == "*" {
			// llm.txt s44: wildcard CORS in production needs an explicit decision,
			// so it cannot be reached by leaving a variable unset.
			return fmt.Errorf("config: ALLOWED_ORIGINS may not be '*'; list origins explicitly")
		}
	}
	return nil
}

func splitCSV(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func setInt(dst *int, key string) error {
	v := os.Getenv(key)
	if v == "" {
		return nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return fmt.Errorf("config: %s %q is not a non-negative number", key, v)
	}
	*dst = n
	return nil
}

func setUint(dst *uint64, key string) error {
	v := os.Getenv(key)
	if v == "" {
		return nil
	}
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return fmt.Errorf("config: %s %q is not a non-negative number", key, v)
	}
	*dst = n
	return nil
}
