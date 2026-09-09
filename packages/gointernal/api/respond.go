// Package api serves ArkSwap analytics over HTTP.
//
// READ ONLY. It holds no keys, never signs anything, and is never the
// transaction authority (llm.txt s37). If it is offline the frontend must still
// be able to swap and manage liquidity directly on-chain (s38).
package api

import (
	"encoding/json"
	"log/slog"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/models"
)

const (
	pageLimitDefault = 50
	pageLimitMax     = 100
)

var addressRe = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

type pagination struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
	Total  int `json:"total"`
}

type listEnvelope struct {
	Data       any        `json:"data"`
	Pagination pagination `json:"pagination"`
}

type dataEnvelope struct {
	Data any `json:"data"`
}

type errBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errEnvelope struct {
	Error errBody `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// fail returns a stable error code and a safe message.
//
// llm.txt s45: database errors and stack traces never reach a client. The real
// error is logged server-side; the caller gets a code they can branch on.
func fail(w http.ResponseWriter, log *slog.Logger, status int, code, message string, err error) {
	if err != nil && log != nil {
		log.Error("request failed", "code", code, "status", status, "error", err)
	}
	writeJSON(w, status, errEnvelope{Error: errBody{Code: code, Message: message}})
}

// parseAddress validates and normalises an address from the URL.
//
// Rejecting malformed input before it reaches a query keeps a bad path segment
// from becoming a slow full-table scan, and keeps stored addresses canonical.
func parseAddress(raw string) (string, bool) {
	s := strings.TrimSpace(raw)
	if !addressRe.MatchString(s) {
		return "", false
	}
	return models.NormalizeAddress(s), true
}

// parsePaging clamps limit/offset (llm.txt s47) so a client cannot ask for the
// whole table in one request.
func parsePaging(r *http.Request) (limit, offset int) {
	limit, offset = pageLimitDefault, 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > pageLimitMax {
		limit = pageLimitMax
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

// usd renders a USD value, or null when it is genuinely unknown.
//
// Serialising unknown as "0" would let a partially priced dataset masquerade as
// a complete one; null forces the consumer to decide.
func usd(r *big.Rat) *string {
	if r == nil {
		return nil
	}
	s := models.FormatUSD(r)
	return &s
}

func amountString(v *big.Int) *string {
	if v == nil {
		return nil
	}
	s := v.String()
	return &s
}
