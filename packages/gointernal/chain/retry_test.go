package chain

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestTransientClassification(t *testing.T) {
	transient := []error{
		errors.New("connection reset by peer"),
		errors.New("Post \"https://rpc\": EOF"),
		errors.New("429 Too Many Requests"),
		errors.New("503 Service Unavailable"),
		errors.New("context deadline exceeded"),
		context.DeadlineExceeded,
	}
	for _, e := range transient {
		if !Transient(e) {
			t.Errorf("expected transient: %v", e)
		}
	}

	permanent := []error{
		errors.New("execution reverted"),
		errors.New("invalid argument 0"),
		errors.New("method eth_foo does not exist/is not available"),
		// A cancelled context is a shutdown, not a fault to retry through.
		context.Canceled,
	}
	for _, e := range permanent {
		if Transient(e) {
			t.Errorf("expected permanent: %v", e)
		}
	}
}

func TestRetrySucceedsAfterTransientFailures(t *testing.T) {
	calls := 0
	got, err := retry(context.Background(), 5, func(context.Context) (int, error) {
		calls++
		if calls < 3 {
			return 0, errors.New("connection reset by peer")
		}
		return 42, nil
	})
	if err != nil || got != 42 {
		t.Fatalf("got %d, %v", got, err)
	}
	if calls != 3 {
		t.Fatalf("calls = %d, want 3", calls)
	}
}

// A permanent error must not consume the retry budget: retrying an invalid
// request just delays surfacing the bug.
func TestRetryStopsImmediatelyOnPermanentError(t *testing.T) {
	calls := 0
	_, err := retry(context.Background(), 5, func(context.Context) (int, error) {
		calls++
		return 0, errors.New("execution reverted")
	})
	if err == nil {
		t.Fatal("expected an error")
	}
	if calls != 1 {
		t.Fatalf("calls = %d, want exactly 1", calls)
	}
}

func TestRetryGivesUpAfterAttempts(t *testing.T) {
	calls := 0
	_, err := retry(context.Background(), 3, func(context.Context) (int, error) {
		calls++
		return 0, fmt.Errorf("504 gateway timeout")
	})
	if err == nil {
		t.Fatal("expected an error")
	}
	if calls != 3 {
		t.Fatalf("calls = %d, want 3", calls)
	}
}

func TestRetryHonoursContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	_, err := retry(ctx, 5, func(context.Context) (int, error) {
		calls++
		return 0, errors.New("connection reset by peer")
	})
	if err == nil {
		t.Fatal("expected an error")
	}
	if calls > 1 {
		t.Fatalf("calls = %d; cancellation should stop retrying", calls)
	}
}
