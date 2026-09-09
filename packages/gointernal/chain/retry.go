// Package chain wraps the Ark JSON-RPC endpoint.
package chain

import (
	"context"
	"errors"
	"net"
	"strings"
	"time"
)

// Transient classifies an RPC error as worth retrying (llm.txt s42).
//
// The distinction matters: retrying a timeout eventually succeeds, but retrying
// a malformed request just burns the retry budget and delays surfacing a real
// bug. Anything not recognised as transient is returned immediately.
func Transient(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	// A cancelled parent context is a shutdown signal, not a transient fault.
	if errors.Is(err, context.Canceled) {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}

	s := strings.ToLower(err.Error())
	for _, needle := range []string{
		"connection reset",
		"connection refused",
		"broken pipe",
		"eof",
		"timeout",
		"timed out",
		// Some RPC layers stringify a deadline instead of wrapping the sentinel.
		"deadline exceeded",
		"too many requests", // 429
		"429",
		"502", "bad gateway",
		"503", "service unavailable",
		"504", "gateway timeout",
		"tls handshake",
		"no such host",
		"server is overloaded",
	} {
		if strings.Contains(s, needle) {
			return true
		}
	}
	return false
}

// retry runs fn with exponential backoff, giving up on non-transient errors.
//
// Backoff is capped so a long outage does not stall the indexer for minutes at a
// time; the caller resumes from the last committed block regardless, so waiting
// longer buys nothing.
func retry[T any](ctx context.Context, attempts int, fn func(context.Context) (T, error)) (T, error) {
	var zero T
	if attempts < 1 {
		attempts = 1
	}
	backoff := 200 * time.Millisecond
	const maxBackoff = 5 * time.Second

	var lastErr error
	for i := 0; i < attempts; i++ {
		v, err := fn(ctx)
		if err == nil {
			return v, nil
		}
		lastErr = err
		if !Transient(err) {
			return zero, err
		}
		if i == attempts-1 {
			break
		}
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(backoff):
		}
		if backoff *= 2; backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
	return zero, lastErr
}
