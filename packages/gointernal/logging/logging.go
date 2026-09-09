// Package logging configures structured logging for both applications.
package logging

import (
	"log/slog"
	"os"
	"strings"
)

// New builds a JSON slog logger tagged with the service name (llm.txt s43).
//
// Credentials are never logged. DATABASE_URL and the RPC URL can both carry
// secrets, so neither is ever passed to a log call — only derived, non-secret
// facts like the chain id.
func New(service, level string) *slog.Logger {
	var lv slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lv = slog.LevelDebug
	case "warn", "warning":
		lv = slog.LevelWarn
	case "error":
		lv = slog.LevelError
	default:
		lv = slog.LevelInfo
	}
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lv})
	return slog.New(h).With("service", service)
}
