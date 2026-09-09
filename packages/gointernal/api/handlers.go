package api

import (
	"context"
	"math/big"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/analytics"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/pricing"
)

type pairView struct {
	Address       string    `json:"address"`
	Token0        tokenView `json:"token0"`
	Token1        tokenView `json:"token1"`
	Reserve0      string    `json:"reserve0"`
	Reserve1      string    `json:"reserve1"`
	TotalSupply   string    `json:"totalSupply"`
	TvlUsd        *string   `json:"tvlUsd"`
	Volume24hUsd  string    `json:"volume24hUsd"`
	Fees24hUsd    string    `json:"fees24hUsd"`
	TxCount24h    int64     `json:"txCount24h"`
	CreatedBlock  uint64    `json:"createdBlock"`
	CreatedTxHash string    `json:"createdTxHash"`
	LastSyncBlock *uint64   `json:"lastSyncBlock"`
	// Estimated, and labelled as such: it assumes today's volume repeats daily
	// and that every swap paid the standard fee (llm.txt s28).
	EstimatedAprPercent *string `json:"estimatedAprPercent"`
}

func (s *Server) pairs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	limit, offset := parsePaging(r)

	engine, byAddr, prs, err := s.priceEngine(ctx)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}

	// Optional token filter, validated before use.
	if raw := r.URL.Query().Get("token"); raw != "" {
		addr, ok := parseAddress(raw)
		if !ok {
			fail(w, s.log, http.StatusBadRequest, "INVALID_ADDRESS", "token is not a valid EVM address", nil)
			return
		}
		var kept []models.Pair
		for _, p := range prs {
			if p.Token0Address == addr || p.Token1Address == addr {
				kept = append(kept, p)
			}
		}
		prs = kept
	}

	total := len(prs)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}

	views := make([]pairView, 0, end-offset)
	for _, p := range prs[offset:end] {
		v, err := s.buildPairView(ctx, p, engine, byAddr)
		if err != nil {
			fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
			return
		}
		views = append(views, v)
	}
	writeJSON(w, http.StatusOK, listEnvelope{Data: views, Pagination: pagination{Limit: limit, Offset: offset, Total: total}})
}

func (s *Server) buildPairView(
	ctx context.Context, p models.Pair, engine *pricing.Engine, byAddr map[string]models.Token,
) (pairView, error) {
	t0, t1 := byAddr[p.Token0Address], byAddr[p.Token1Address]

	var p0, p1 *big.Rat
	if pr := engine.PriceUSD(t0); pr != nil {
		p0 = pr.USD
	}
	if pr := engine.PriceUSD(t1); pr != nil {
		p1 = pr.USD
	}
	tvl := analytics.PairTVL(p.Reserve0, t0, p0, p.Reserve1, t1, p1)

	addr := p.Address
	win, err := s.store.VolumeSince(ctx, time.Now().Add(-24*time.Hour), &addr)
	if err != nil {
		return pairView{}, err
	}
	fees := analytics.EstimatedFeesUSD(win.VolumeUSD)

	return pairView{
		Address:     p.Address,
		Token0:      view(t0, p0),
		Token1:      view(t1, p1),
		Reserve0:    p.Reserve0.String(),
		Reserve1:    p.Reserve1.String(),
		TotalSupply: p.TotalSupply.String(),
		TvlUsd:      usd(tvl),
		Volume24hUsd: models.FormatUSD(win.VolumeUSD),
		Fees24hUsd:   models.FormatUSD(fees),
		TxCount24h:   win.TxCount,
		CreatedBlock: p.CreatedBlock, CreatedTxHash: p.CreatedTxHash,
		LastSyncBlock:       p.LastSyncBlock,
		EstimatedAprPercent: usd(analytics.EstimatedAPRPercent(fees, tvl)),
	}, nil
}

func (s *Server) pairDetail(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	addr, ok := parseAddress(chi.URLParam(r, "address"))
	if !ok {
		fail(w, s.log, http.StatusBadRequest, "INVALID_ADDRESS", "Not a valid EVM address", nil)
		return
	}
	p, err := s.store.Pair(ctx, addr)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	if p == nil {
		fail(w, s.log, http.StatusNotFound, "PAIR_NOT_FOUND", "Pair not found", nil)
		return
	}
	engine, byAddr, _, err := s.priceEngine(ctx)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	v, err := s.buildPairView(ctx, *p, engine, byAddr)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	writeJSON(w, http.StatusOK, dataEnvelope{Data: v})
}

type swapView struct {
	TxHash      string  `json:"txHash"`
	LogIndex    uint    `json:"logIndex"`
	BlockNumber uint64  `json:"blockNumber"`
	Timestamp   uint64  `json:"timestamp"`
	PairAddress string  `json:"pairAddress"`
	Sender      string  `json:"sender"`
	Recipient   string  `json:"recipient"`
	TokenIn     *string `json:"tokenIn"`
	TokenOut    *string `json:"tokenOut"`
	TokenInSymbol  *string `json:"tokenInSymbol"`
	TokenOutSymbol *string `json:"tokenOutSymbol"`
	AmountIn    *string `json:"amountIn"`
	AmountOut   *string `json:"amountOut"`
	AmountUsd   *string `json:"amountUsd"`
}

func (s *Server) swapsPage(w http.ResponseWriter, r *http.Request, pair, account *string) {
	limit, offset := parsePaging(r)
	rows, total, err := s.store.SwapsPage(r.Context(), pair, account, limit, offset)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	views := make([]swapView, 0, len(rows))
	for _, sw := range rows {
		views = append(views, swapView{
			TxHash: sw.TxHash, LogIndex: sw.LogIndex, BlockNumber: sw.BlockNumber,
			Timestamp: sw.Timestamp, PairAddress: sw.PairAddress,
			Sender: sw.Sender, Recipient: sw.Recipient,
			TokenIn: sw.TokenInAddress, TokenOut: sw.TokenOutAddress,
			TokenInSymbol: sw.TokenInSymbol, TokenOutSymbol: sw.TokenOutSymbol,
			AmountIn: amountString(sw.AmountIn), AmountOut: amountString(sw.AmountOut),
			AmountUsd: usd(sw.AmountUSD),
		})
	}
	writeJSON(w, http.StatusOK, listEnvelope{Data: views, Pagination: pagination{Limit: limit, Offset: offset, Total: total}})
}

func (s *Server) pairSwaps(w http.ResponseWriter, r *http.Request) {
	addr, ok := parseAddress(chi.URLParam(r, "address"))
	if !ok {
		fail(w, s.log, http.StatusBadRequest, "INVALID_ADDRESS", "Not a valid EVM address", nil)
		return
	}
	s.swapsPage(w, r, &addr, nil)
}

func (s *Server) accountSwaps(w http.ResponseWriter, r *http.Request) {
	addr, ok := parseAddress(chi.URLParam(r, "address"))
	if !ok {
		fail(w, s.log, http.StatusBadRequest, "INVALID_ADDRESS", "Not a valid EVM address", nil)
		return
	}
	s.swapsPage(w, r, nil, &addr)
}

type liquidityView struct {
	TxHash      string  `json:"txHash"`
	LogIndex    uint    `json:"logIndex"`
	BlockNumber uint64  `json:"blockNumber"`
	Timestamp   uint64  `json:"timestamp"`
	PairAddress string  `json:"pairAddress"`
	EventType   string  `json:"eventType"`
	Sender      *string `json:"sender"`
	Recipient   *string `json:"recipient"`
	Amount0     string  `json:"amount0"`
	Amount1     string  `json:"amount1"`
	AmountUsd   *string `json:"amountUsd"`
}

func (s *Server) pairLiquidity(w http.ResponseWriter, r *http.Request) {
	addr, ok := parseAddress(chi.URLParam(r, "address"))
	if !ok {
		fail(w, s.log, http.StatusBadRequest, "INVALID_ADDRESS", "Not a valid EVM address", nil)
		return
	}
	limit, offset := parsePaging(r)
	rows, total, err := s.store.LiquidityPage(r.Context(), addr, limit, offset)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	views := make([]liquidityView, 0, len(rows))
	for _, e := range rows {
		views = append(views, liquidityView{
			TxHash: e.TxHash, LogIndex: e.LogIndex, BlockNumber: e.BlockNumber,
			Timestamp: e.Timestamp, PairAddress: e.PairAddress, EventType: string(e.EventType),
			Sender: e.Sender, Recipient: e.Recipient,
			Amount0: e.Amount0.String(), Amount1: e.Amount1.String(), AmountUsd: usd(e.AmountUSD),
		})
	}
	writeJSON(w, http.StatusOK, listEnvelope{Data: views, Pagination: pagination{Limit: limit, Offset: offset, Total: total}})
}

func (s *Server) pairChart(w http.ResponseWriter, r *http.Request) {
	addr, ok := parseAddress(chi.URLParam(r, "address"))
	if !ok {
		fail(w, s.log, http.StatusBadRequest, "INVALID_ADDRESS", "Not a valid EVM address", nil)
		return
	}

	bucket := int64(models.BucketHour)
	window := 7 * 24 * time.Hour
	switch r.URL.Query().Get("interval") {
	case "", "1h":
	case "1d":
		bucket, window = int64(models.BucketDay), 90*24*time.Hour
	default:
		fail(w, s.log, http.StatusBadRequest, "INVALID_INTERVAL", "interval must be 1h or 1d", nil)
		return
	}

	points, err := s.store.ChartBuckets(r.Context(), addr, bucket, time.Now().Add(-window))
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}

	type point struct {
		Timestamp int64   `json:"timestamp"`
		Price     *string `json:"price"`
		TvlUsd    *string `json:"tvlUsd"`
		VolumeUsd string  `json:"volumeUsd"`
		TxCount   int64   `json:"txCount"`
	}
	out := make([]point, 0, len(points))
	for _, p := range points {
		// price and tvlUsd are null by design: reconstructing them needs
		// per-block reserve snapshots, which the MVP does not record. Reporting
		// today's price against a historical bucket would be a fabricated series.
		out = append(out, point{Timestamp: p.Bucket, VolumeUsd: models.FormatUSD(p.VolumeUSD), TxCount: p.TxCount})
	}
	writeJSON(w, http.StatusOK, dataEnvelope{Data: out})
}

func (s *Server) tokens(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	limit, offset := parsePaging(r)
	engine, _, _, err := s.priceEngine(ctx)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	toks, err := s.store.Tokens(ctx)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	total := len(toks)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	views := make([]tokenView, 0, end-offset)
	for _, t := range toks[offset:end] {
		var price *big.Rat
		if pr := engine.PriceUSD(t); pr != nil {
			price = pr.USD
		}
		views = append(views, view(t, price))
	}
	writeJSON(w, http.StatusOK, listEnvelope{Data: views, Pagination: pagination{Limit: limit, Offset: offset, Total: total}})
}

func (s *Server) tokenDetail(w http.ResponseWriter, r *http.Request) {
	t, price, ok := s.lookupToken(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, dataEnvelope{Data: view(*t, price)})
}

func (s *Server) tokenPrice(w http.ResponseWriter, r *http.Request) {
	t, price, ok := s.lookupToken(w, r)
	if !ok {
		return
	}
	engine, _, _, err := s.priceEngine(r.Context())
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return
	}
	body := map[string]any{"address": t.Address, "priceUsd": usd(price)}
	if pr := engine.PriceUSD(*t); pr != nil {
		// The route is reported so an implausible price can be traced to the pool
		// it came from rather than taken on faith (llm.txt s23).
		body["source"] = string(pr.Source)
		body["sourcePair"] = pr.SourcePair
		body["liquidityUsd"] = usd(pr.LiquidityUSD)
	}
	body["disclaimer"] = "Spot price from pool reserves. Analytics only — not an oracle."
	writeJSON(w, http.StatusOK, dataEnvelope{Data: body})
}

func (s *Server) lookupToken(w http.ResponseWriter, r *http.Request) (*models.Token, *big.Rat, bool) {
	ctx := r.Context()
	addr, ok := parseAddress(chi.URLParam(r, "address"))
	if !ok {
		fail(w, s.log, http.StatusBadRequest, "INVALID_ADDRESS", "Not a valid EVM address", nil)
		return nil, nil, false
	}
	t, err := s.store.Token(ctx, addr)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return nil, nil, false
	}
	if t == nil {
		fail(w, s.log, http.StatusNotFound, "TOKEN_NOT_FOUND", "Token not found", nil)
		return nil, nil, false
	}
	engine, _, _, err := s.priceEngine(ctx)
	if err != nil {
		fail(w, s.log, http.StatusServiceUnavailable, "DATABASE_UNAVAILABLE", "Analytics database unavailable", err)
		return nil, nil, false
	}
	var price *big.Rat
	if pr := engine.PriceUSD(*t); pr != nil {
		price = pr.USD
	}
	return t, price, true
}
