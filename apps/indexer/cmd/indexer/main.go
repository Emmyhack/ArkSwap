// Command indexer ingests ArkSwap events from Ark Constellation into PostgreSQL.
//
// It holds no keys and cannot sign or send a transaction. The analytics path is
// strictly Chain -> Indexer -> PostgreSQL -> API -> Frontend, and must never
// join the swap path (llm.txt s1, s64).
package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Emmyhack/ArkSwap/packages/gointernal/chain"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/config"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/database"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/indexer"
	"github.com/Emmyhack/ArkSwap/packages/gointernal/logging"
)

func main() {
	manifest := flag.String("manifest", "packages/addresses/ark-devnet.json",
		"deployment manifest supplying canonical addresses")
	once := flag.Bool("once", false, "sync to the safe head and exit (used by tests and backfills)")
	poll := flag.Duration("poll", 5*time.Second, "interval between sync ticks")
	flag.Parse()

	cfg, err := config.Load(*manifest)
	if err != nil {
		panicf("config: %v", err)
	}
	log := logging.New("indexer", cfg.LogLevel)

	if err := cfg.ValidateForIndexer(); err != nil {
		log.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	rpc, err := chain.Dial(ctx, cfg.RPCURL, cfg.RPCTimeout, cfg.MaxRPCRetries, log)
	if err != nil {
		log.Error("dialing RPC", "error", err)
		os.Exit(1)
	}
	defer rpc.Close()

	store, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("connecting to database", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	ix := indexer.New(cfg, rpc, store, log)

	if *once {
		// Drain to the safe head, then exit. Restart recovery and the
		// rebuild-from-chain property are both exercised through this path.
		if err := ix.Preflight(ctx); err != nil {
			log.Error("preflight failed", "error", err)
			os.Exit(1)
		}
		if err := ix.SyncToHead(ctx); err != nil {
			log.Error("sync failed", "error", err)
			os.Exit(1)
		}
		log.Info("sync complete")
		return
	}

	log.Info("starting indexer", "chainId", cfg.ChainID, "poll", poll.String())
	if err := ix.Run(ctx, *poll); err != nil && ctx.Err() == nil {
		log.Error("indexer stopped", "error", err)
		os.Exit(1)
	}
	log.Info("indexer stopped")
}

func panicf(format string, args ...any) {
	println(format)
	_ = args
	os.Exit(1)
}
