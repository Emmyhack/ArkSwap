package chain

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// HeadStream delivers new chain heads over a WebSocket subscription (llm.txt s17).
//
// It exists purely to shorten the latency between a block landing and the
// indexer noticing it. It is never the authority on what to index: the caller
// still reads its own cursor and the confirmed head over HTTP, so a missed,
// duplicated or out-of-order notification costs nothing. That is why heads are
// delivered on a buffered channel that drops rather than blocks — falling
// behind on notifications must not stall the node's subscription goroutine.
//
// Like Client, this holds no keys and cannot transact.
type HeadStream struct {
	heads chan uint64
	errs  chan error
	ec    *ethclient.Client
	stop  func()
}

// SubscribeHeads opens a newHeads subscription.
//
// Returns an error rather than falling back internally: whether to degrade to
// polling is the caller's decision, and hiding a dead WebSocket behind a
// working-looking stream would make that failure invisible.
func SubscribeHeads(ctx context.Context, wsURL string, log *slog.Logger) (*HeadStream, error) {
	if wsURL == "" {
		return nil, fmt.Errorf("chain: no WebSocket URL configured")
	}

	dialCtx, cancelDial := context.WithTimeout(ctx, 15*time.Second)
	defer cancelDial()

	ec, err := ethclient.DialContext(dialCtx, wsURL)
	if err != nil {
		return nil, fmt.Errorf("chain: dialing WebSocket: %w", err)
	}

	raw := make(chan *types.Header, 32)
	subCtx, cancelSub := context.WithCancel(ctx)
	sub, err := ec.SubscribeNewHead(subCtx, raw)
	if err != nil {
		cancelSub()
		ec.Close()
		return nil, fmt.Errorf("chain: subscribing to newHeads: %w", err)
	}

	s := &HeadStream{
		heads: make(chan uint64, 32),
		errs:  make(chan error, 1),
		ec:    ec,
	}
	s.stop = func() {
		cancelSub()
		sub.Unsubscribe()
		ec.Close()
	}

	go func() {
		defer close(s.heads)
		for {
			select {
			case <-subCtx.Done():
				return
			case err := <-sub.Err():
				if err == nil {
					err = fmt.Errorf("chain: newHeads subscription closed")
				}
				select {
				case s.errs <- err:
				default:
				}
				return
			case h := <-raw:
				if h == nil || h.Number == nil {
					continue
				}
				select {
				case s.heads <- h.Number.Uint64():
				default:
					// The consumer is mid-batch. Dropping is correct: it will read
					// the true head over HTTP on its next tick anyway, so the only
					// thing lost is a wake-up it no longer needs.
					if log != nil {
						log.Debug("dropping head notification; indexer is busy", "block", h.Number.Uint64())
					}
				}
			}
		}
	}()

	return s, nil
}

// Heads yields the number of each new block.
func (s *HeadStream) Heads() <-chan uint64 { return s.heads }

// Err reports a subscription that has ended. The stream delivers nothing after.
func (s *HeadStream) Err() <-chan error { return s.errs }

func (s *HeadStream) Close() {
	if s.stop != nil {
		s.stop()
	}
}
