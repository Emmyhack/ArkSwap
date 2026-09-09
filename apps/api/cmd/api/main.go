// Command api serves ArkSwap analytics over HTTP.
//
// Read-only by construction: it holds no keys and cannot sign or send a
// transaction. Stopping it must never stop users swapping — the frontend talks
// to the chain directly for anything that moves funds (llm.txt s37, s38).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/api"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/chain"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/config"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/database"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/logging"
)

func main() {
	manifest := flag.String("manifest", "packages/addresses/ark-devnet.json",
		"deployment manifest supplying canonical addresses")
	flag.Parse()

	cfg, err := config.Load(*manifest)
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}
	log := logging.New("api", cfg.LogLevel)

	if err := cfg.ValidateForAPI(); err != nil {
		log.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("connecting to database", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	// The chain client is optional: it only powers the lag figure in /health.
	// The API must still serve if the RPC endpoint is unreachable.
	var rpc *chain.Client
	if cfg.RPCURL != "" {
		if c, err := chain.Dial(ctx, cfg.RPCURL, cfg.RPCTimeout, cfg.MaxRPCRetries, log); err == nil {
			rpc = c
			defer rpc.Close()
		} else {
			log.Warn("RPC unavailable; /health will report lag without a chain head", "error", err)
		}
	}

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.APIPort),
		Handler:           api.NewServer(cfg, store, rpc, log).Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("api listening", "port", cfg.APIPort, "chainId", cfg.ChainID, "origins", cfg.AllowedOrigins)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server stopped", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Info("api stopped")
}
