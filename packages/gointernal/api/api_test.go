package api

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/config"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/database"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/logging"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

const (
	wkash = "0x6792d2fd02d8a55c543f627d0e90526f9278c6d6"
	musdc = "0xc8d15f9a42ee3107ab1257e38199e3bf899dcfb3"
	pairA = "0x022850a98a241ff9e3978cd1b596295cf1451719"
)

func dp(i int) *int { return &i }
func sp(s string) *string { return &s }

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://arkswap:arkswap@localhost:5432/arkswap_test?sslmode=disable"
	}
	ctx := context.Background()
	store, err := database.Connect(ctx, url)
	if err != nil {
		t.Skipf("no test database available (%v)", err)
	}
	t.Cleanup(store.Close)
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if _, err := store.Pool().Exec(ctx, `
		TRUNCATE swaps, liquidity_events, pair_snapshots, token_prices,
		         pairs, tokens, blocks, indexer_state RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}

	// A pool deep enough to clear the price floor: 100 WKASH : 300,000 mUSDC.
	err = store.InBlockTx(ctx, func(tx *database.Tx) error {
		if err := tx.UpsertToken(ctx, models.Token{
			Address: wkash, Symbol: sp("WKASH"), Name: sp("Wrapped KASH"),
			Decimals: dp(18), MetadataComplete: true, IsWKASH: true,
		}); err != nil {
			return err
		}
		if err := tx.UpsertToken(ctx, models.Token{
			Address: musdc, Symbol: sp("mUSDC"), Name: sp("Mock USD Coin"),
			Decimals: dp(6), MetadataComplete: true, IsStable: true,
		}); err != nil {
			return err
		}
		r0, _ := new(big.Int).SetString("100000000000000000000", 10)
		if err := tx.UpsertPair(ctx, models.Pair{
			Address: pairA, Token0Address: wkash, Token1Address: musdc,
			Reserve0: r0, Reserve1: big.NewInt(300_000_000_000), TotalSupply: big.NewInt(1),
			CreatedBlock: 177509, CreatedTxHash: "0xcreate", CreatedLogIndex: 0, CreatedTimestamp: 1788405514,
		}); err != nil {
			return err
		}
		if err := tx.SetPairReserves(ctx, pairA, r0, big.NewInt(300_000_000_000), 177509); err != nil {
			return err
		}
		return tx.SetIndexerState(ctx, models.IndexerState{
			ChainID: 9000, LastProcessedBlock: 329898, LastProcessedBlockHash: "0xhead",
		})
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	cfg := &config.Config{
		ChainID: 9000, AllowedOrigins: []string{"http://localhost:3000"},
		MinPriceLiquidityUSD: big.NewRat(1000, 1), Confirmations: 3,
	}
	srv := httptest.NewServer(NewServer(cfg, store, nil, logging.New("api-test", "error")).Routes())
	t.Cleanup(srv.Close)
	return srv
}

func getJSON(t *testing.T, url string) (int, map[string]any) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer res.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	return res.StatusCode, body
}

func TestHealth(t *testing.T) {
	s := newTestServer(t)
	code, body := getJSON(t, s.URL+"/api/v1/health")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	d := body["data"].(map[string]any)
	if d["chainId"] != "9000" {
		t.Errorf("chainId = %v", d["chainId"])
	}
	if d["lastIndexedBlock"].(float64) != 329898 {
		t.Errorf("lastIndexedBlock = %v", d["lastIndexedBlock"])
	}
}

func TestStatsPricesDeepPool(t *testing.T) {
	s := newTestServer(t)
	code, body := getJSON(t, s.URL+"/api/v1/stats")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	d := body["data"].(map[string]any)
	// 100 WKASH at $3,000 + 300,000 mUSDC at $1 = $600,000.
	if d["tvlUsd"] != "600000" {
		t.Errorf("tvlUsd = %v, want 600000", d["tvlUsd"])
	}
	if d["totalPairs"].(float64) != 1 {
		t.Errorf("totalPairs = %v", d["totalPairs"])
	}
}

func TestPairDetailAndNotFound(t *testing.T) {
	s := newTestServer(t)

	code, body := getJSON(t, s.URL+"/api/v1/pairs/"+pairA)
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	d := body["data"].(map[string]any)
	if d["address"] != pairA {
		t.Errorf("address = %v", d["address"])
	}
	if d["token0"].(map[string]any)["symbol"] != "WKASH" {
		t.Errorf("token0 = %v", d["token0"])
	}

	code, body = getJSON(t, s.URL+"/api/v1/pairs/0x0000000000000000000000000000000000000001")
	if code != 404 {
		t.Fatalf("status %d, want 404", code)
	}
	if body["error"].(map[string]any)["code"] != "PAIR_NOT_FOUND" {
		t.Errorf("error = %v", body["error"])
	}
}

// llm.txt s45: a malformed address must be rejected before it reaches SQL.
func TestInvalidAddressRejected(t *testing.T) {
	s := newTestServer(t)
	for _, bad := range []string{
		"not-an-address",
		"0x123",
		"0x' OR 1=1--",
		"0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
	} {
		code, body := getJSON(t, s.URL+"/api/v1/pairs/"+bad)
		if code != 400 {
			t.Errorf("%q: status %d, want 400", bad, code)
			continue
		}
		if body["error"].(map[string]any)["code"] != "INVALID_ADDRESS" {
			t.Errorf("%q: error = %v", bad, body["error"])
		}
	}
}

// A SQL-injection attempt in a path segment must be rejected, and must not
// disturb the data.
func TestInjectionAttemptIsHarmless(t *testing.T) {
	s := newTestServer(t)
	getJSON(t, s.URL+"/api/v1/pairs/0x'%3B%20DROP%20TABLE%20swaps%3B--/swaps")
	code, body := getJSON(t, s.URL+"/api/v1/stats")
	if code != 200 {
		t.Fatalf("stats broke after injection attempt: %d", code)
	}
	if _, ok := body["data"]; !ok {
		t.Fatal("stats returned no data after injection attempt")
	}
}

// llm.txt s47: limit is clamped so a client cannot request the whole table.
func TestPaginationIsClamped(t *testing.T) {
	s := newTestServer(t)
	_, body := getJSON(t, s.URL+"/api/v1/pairs?limit=99999")
	p := body["pagination"].(map[string]any)
	if p["limit"].(float64) != float64(pageLimitMax) {
		t.Errorf("limit = %v, want clamp to %d", p["limit"], pageLimitMax)
	}

	_, body = getJSON(t, s.URL+"/api/v1/pairs?limit=abc&offset=-5")
	p = body["pagination"].(map[string]any)
	if p["limit"].(float64) != float64(pageLimitDefault) || p["offset"].(float64) != 0 {
		t.Errorf("bad paging input not defaulted: %v", p)
	}
}

func TestTokenPriceReportsItsRoute(t *testing.T) {
	s := newTestServer(t)
	code, body := getJSON(t, s.URL+"/api/v1/tokens/"+wkash+"/price")
	if code != 200 {
		t.Fatalf("status %d", code)
	}
	d := body["data"].(map[string]any)
	if d["priceUsd"] != "3000" {
		t.Errorf("priceUsd = %v, want 3000", d["priceUsd"])
	}
	if d["source"] != "DIRECT_STABLE" {
		t.Errorf("source = %v", d["source"])
	}
	if d["disclaimer"] == nil {
		t.Error("price response must carry the not-an-oracle disclaimer")
	}
}

// llm.txt s44: only configured origins get CORS headers.
func TestCORSAllowsOnlyConfiguredOrigins(t *testing.T) {
	s := newTestServer(t)

	req, _ := http.NewRequest("GET", s.URL+"/api/v1/health", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("allowed origin header = %q", got)
	}

	req, _ = http.NewRequest("GET", s.URL+"/api/v1/health", nil)
	req.Header.Set("Origin", "https://evil.example")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("unconfigured origin was allowed: %q", got)
	}
}

func TestChartRejectsUnknownInterval(t *testing.T) {
	s := newTestServer(t)
	code, body := getJSON(t, s.URL+"/api/v1/pairs/"+pairA+"/chart?interval=5m")
	if code != 400 || body["error"].(map[string]any)["code"] != "INVALID_INTERVAL" {
		t.Fatalf("status %d body %v", code, body)
	}
	if code, _ := getJSON(t, s.URL+"/api/v1/pairs/"+pairA+"/chart?interval=1d"); code != 200 {
		t.Fatalf("1d interval rejected: %d", code)
	}
}
