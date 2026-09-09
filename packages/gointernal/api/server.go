package api

import (
	"context"
	"log/slog"
	"math/big"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/analytics"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/chain"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/config"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/database"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/pricing"
)

// Server owns the HTTP surface.
//
// The chain client is optional and read-only. It is used for /health, so the
// endpoint can report genuine indexer lag against the live head rather than the
// database's opinion of it.
type Server struct {
	cfg   *config.Config
	store *database.Store
	rpc   *chain.Client
	log   *slog.Logger
}

func NewServer(cfg *config.Config, store *database.Store, rpc *chain.Client, log *slog.Logger) *Server {
	return &Server{cfg: cfg, store: store, rpc: rpc, log: log}
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(20 * time.Second))
	r.Use(s.cors)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", s.health)
		r.Get("/stats", s.stats)

		r.Get("/pairs", s.pairs)
		r.Get("/pairs/{address}", s.pairDetail)
		r.Get("/pairs/{address}/swaps", s.pairSwaps)
		r.Get("/pairs/{address}/liquidity", s.pairLiquidity)
		r.Get("/pairs/{address}/chart", s.pairChart)

		r.Get("/tokens", s.tokens)
		r.Get("/tokens/{address}", s.tokenDetail)
		r.Get("/tokens/{address}/price", s.tokenPrice)

		r.Get("/accounts/{address}/swaps", s.accountSwaps)
	})
	return r
}

// cors allows only configured origins.
//
// llm.txt s44: no wildcard. Config rejects "*" outright, so a missing variable
// cannot silently open the API to every origin.
func (s *Server) cors(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range s.cfg.AllowedOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// priceEngine builds a pricing view over current pair and token state.
func (s *Server) priceEngine(ctx context.Context) (*pricing.Engine, map[string]models.Token, []models.Pair, error) {
	toks, err := s.store.Tokens(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	byAddr := make(map[string]models.Token, len(toks))
	for _, t := range toks {
		byAddr[t.Address] = t
	}
	prs, err := s.store.Pairs(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	pools := make([]pricing.Pool, 0, len(prs))
	for _, p := range prs {
		pools = append(pools, pricing.Pool{
			Address: p.Address,
			Token0:  byAddr[p.Token0Address], Token1: byAddr[p.Token1Address],
			Reserve0: p.Reserve0, Reserve1: p.Reserve1,
		})
	}
	pricing.SortPoolsByAddress(pools)
	return pricing.NewEngine(pools, s.cfg.MinPriceLiquidityUSD), byAddr, prs, nil
}

type tokenView struct {
	Address          string  `json:"address"`
	Symbol           *string `json:"symbol"`
	Name             *string `json:"name"`
	Decimals         *int    `json:"decimals"`
	MetadataComplete bool    `json:"metadataComplete"`
	IsWhitelisted    bool    `json:"isWhitelisted"`
	IsStable         bool    `json:"isStable"`
	IsWkash          bool    `json:"isWkash"`
	PriceUSD         *string `json:"priceUsd"`
}

func view(t models.Token, price *big.Rat) tokenView {
	return tokenView{
		Address: t.Address, Symbol: t.Symbol, Name: t.Name, Decimals: t.Decimals,
		MetadataComplete: t.MetadataComplete,
		// Curated, and deliberately separate from metadata: a pair being
		// canonical says nothing about whether its tokens are safe (llm.txt s46).
		IsWhitelisted: t.IsWhitelisted, IsStable: t.IsStable, IsWkash: t.IsWKASH,
		PriceUSD: usd(price),
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	st, err := s.store.IndexerState(ctx, s.cfg.ChainID)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}

	var head uint64
	if s.rpc != nil {
		if h, err := s.rpc.BlockNumber(ctx); err == nil {
			head = h
		}
	}
	var indexed uint64
	if st != nil {
		indexed = st.LastProcessedBlock
	}
	lag := int64(head) - int64(indexed)
	if lag < 0 {
		lag = 0
	}

	// Degraded rather than unhealthy: stale analytics are still useful, and the
	// frontend must keep working regardless (llm.txt s30, s38).
	status := "ok"
	if st == nil || (head > 0 && lag > int64(s.cfg.Confirmations)+50) {
		status = "degraded"
	}

	writeJSON(w, http.StatusOK, dataEnvelope{Data: map[string]any{
		"status":           status,
		"chainId":          itoa(s.cfg.ChainID),
		"latestChainBlock": head,
		"lastIndexedBlock": indexed,
		"lag":              lag,
	}})
}

func itoa(v uint64) string { return new(big.Int).SetUint64(v).String() }

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	engine, byAddr, prs, err := s.priceEngine(ctx)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}

	var tvls []*big.Rat
	for _, p := range prs {
		t0, t1 := byAddr[p.Token0Address], byAddr[p.Token1Address]
		var p0, p1 *big.Rat
		if pr := engine.PriceUSD(t0); pr != nil {
			p0 = pr.USD
		}
		if pr := engine.PriceUSD(t1); pr != nil {
			p1 = pr.USD
		}
		tvls = append(tvls, analytics.PairTVL(p.Reserve0, t0, p0, p.Reserve1, t1, p1))
	}
	tvl, priced, unpriced := analytics.SumUSD(tvls)

	now := time.Now()
	day, err := s.store.VolumeSince(ctx, now.Add(-24*time.Hour), nil)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	week, err := s.store.VolumeSince(ctx, now.Add(-7*24*time.Hour), nil)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}

	writeJSON(w, http.StatusOK, dataEnvelope{Data: map[string]any{
		"tvlUsd":              models.FormatUSD(tvl),
		"volume24hUsd":        models.FormatUSD(day.VolumeUSD),
		"volume7dUsd":         models.FormatUSD(week.VolumeUSD),
		"estimatedFees24hUsd": models.FormatUSD(analytics.EstimatedFeesUSD(day.VolumeUSD)),
		"totalPairs":          len(prs),
		"transactions24h":     day.TxCount,
		// Surfaced so a caller can tell a complete figure from a partial one
		// instead of assuming every pool was priced.
		"pairsPriced":     priced,
		"pairsUnpriced":   unpriced,
		"unpricedSwaps24h": day.Unpriced,
	}})
}
