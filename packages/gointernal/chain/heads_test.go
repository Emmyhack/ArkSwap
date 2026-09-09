package chain

import (
	"context"
	"testing"
)

// A missing or unreachable WebSocket must surface as an error the caller can
// step over, never as a stream that looks alive and delivers nothing. The
// indexer decides to degrade to polling on the strength of this error.
func TestSubscribeHeadsReportsUnusableEndpoints(t *testing.T) {
	ctx := context.Background()

	for _, tc := range []struct{ name, url string }{
		{"unconfigured", ""},
		{"wrong scheme", "http://127.0.0.1:1"},
		{"nothing listening", "ws://127.0.0.1:1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, err := SubscribeHeads(ctx, tc.url, nil)
			if err == nil {
				s.Close()
				t.Fatal("want an error so the caller can fall back to polling")
			}
		})
	}
}
