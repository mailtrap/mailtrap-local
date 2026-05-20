package live

import (
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeSubscriber records every Send and reports counts. The optional
// `failOnSend` flag makes Send return an error so we can exercise the
// "drop subscriber on send failure" path; `blockSend` blocks every
// Send until released, to exercise the slow-subscriber path.
type fakeSubscriber struct {
	mu         sync.Mutex
	frames     [][]byte
	closed     atomic.Bool
	failOnSend bool
	blockSend  chan struct{} // nil → no block; non-nil → wait until closed
}

func (f *fakeSubscriber) Send(b []byte) error {
	if f.blockSend != nil {
		<-f.blockSend
	}
	if f.failOnSend {
		return errors.New("send: simulated failure")
	}
	f.mu.Lock()
	// Copy: callers may reuse the buffer.
	cp := make([]byte, len(b))
	copy(cp, b)
	f.frames = append(f.frames, cp)
	f.mu.Unlock()
	return nil
}

func (f *fakeSubscriber) Close() error {
	f.closed.Store(true)
	return nil
}

func (f *fakeSubscriber) frameCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.frames)
}

func (f *fakeSubscriber) lastFrame() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.frames) == 0 {
		return nil
	}
	return f.frames[len(f.frames)-1]
}

// waitFor polls fn until it returns true or the deadline passes. Used
// throughout because Send is now async — broadcasts queue the frame
// and a per-subscriber goroutine drains it.
func waitFor(t *testing.T, deadline time.Duration, msg string, fn func() bool) {
	t.Helper()
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		if fn() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("waitFor timed out after %v: %s", deadline, msg)
}

func TestHubSubscribeAndCount(t *testing.T) {
	t.Parallel()
	h := NewHub()
	if got := h.Count(); got != 0 {
		t.Errorf("empty hub: Count() = %d, want 0", got)
	}
	h.Subscribe(&fakeSubscriber{})
	h.Subscribe(&fakeSubscriber{})
	if got := h.Count(); got != 2 {
		t.Errorf("after 2 subscribes: Count() = %d, want 2", got)
	}
}

func TestHubUnsubscribeClosesSubscriber(t *testing.T) {
	t.Parallel()
	h := NewHub()
	s := &fakeSubscriber{}
	h.Subscribe(s)
	h.Unsubscribe(s)
	if h.Count() != 0 {
		t.Errorf("after unsubscribe: Count() = %d, want 0", h.Count())
	}
	// Close happens in the writer goroutine's defer, so we wait.
	waitFor(t, time.Second, "subscriber.Close()", func() bool { return s.closed.Load() })
}

func TestBroadcastCreatedFanout(t *testing.T) {
	t.Parallel()
	h := NewHub()
	a := &fakeSubscriber{}
	b := &fakeSubscriber{}
	c := &fakeSubscriber{}
	h.Subscribe(a)
	h.Subscribe(b)
	h.Subscribe(c)

	payload := json.RawMessage(`{"id":"abc","subject":"hi"}`)
	h.BroadcastCreated(payload)

	for name, s := range map[string]*fakeSubscriber{"a": a, "b": b, "c": c} {
		// Async dispatch — wait for the writer goroutine to drain.
		waitFor(t, time.Second, "subscriber "+name+" frame", func() bool {
			return s.frameCount() == 1
		})
		var frame struct {
			Type    string          `json:"type"`
			Message json.RawMessage `json:"message"`
		}
		if err := json.Unmarshal(s.lastFrame(), &frame); err != nil {
			t.Fatalf("subscriber %s: unmarshal frame: %v", name, err)
		}
		if frame.Type != "created" {
			t.Errorf("subscriber %s: type = %q, want %q", name, frame.Type, "created")
		}
		if string(frame.Message) != string(payload) {
			t.Errorf("subscriber %s: message payload = %q, want %q",
				name, string(frame.Message), string(payload))
		}
	}
}

func TestBroadcastDestroyedFanout(t *testing.T) {
	t.Parallel()
	h := NewHub()
	s := &fakeSubscriber{}
	h.Subscribe(s)

	h.BroadcastDestroyed("msg-42")

	waitFor(t, time.Second, "destroyed frame", func() bool {
		return s.frameCount() == 1
	})
	var frame struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	}
	if err := json.Unmarshal(s.lastFrame(), &frame); err != nil {
		t.Fatal(err)
	}
	if frame.Type != "destroyed" || frame.ID != "msg-42" {
		t.Errorf("frame = %+v, want {type:destroyed, id:msg-42}", frame)
	}
}

// TestBroadcastDropsFailingSubscriber — when Send returns an error, the
// hub auto-unsubscribes that consumer (and closes it). The other
// subscribers continue to receive future broadcasts unaffected.
func TestBroadcastDropsFailingSubscriber(t *testing.T) {
	t.Parallel()
	h := NewHub()
	healthy := &fakeSubscriber{}
	broken := &fakeSubscriber{failOnSend: true}
	h.Subscribe(healthy)
	h.Subscribe(broken)

	h.BroadcastCreated(json.RawMessage(`{}`))

	// Wait for the broken writer to discover the Send error and self-
	// drop. Count drops from 2 to 1.
	waitFor(t, time.Second, "broken sub dropped", func() bool {
		return h.Count() == 1
	})
	waitFor(t, time.Second, "broken sub Close()", func() bool { return broken.closed.Load() })
	waitFor(t, time.Second, "healthy sub frame", func() bool { return healthy.frameCount() == 1 })

	// A second broadcast still reaches healthy.
	h.BroadcastDestroyed("x")
	waitFor(t, time.Second, "second frame to healthy", func() bool {
		return healthy.frameCount() == 2
	})
}

// TestBroadcastWithNoSubscribers — broadcasting against an empty hub
// must not panic or block.
func TestBroadcastWithNoSubscribers(t *testing.T) {
	t.Parallel()
	h := NewHub()
	h.BroadcastCreated(json.RawMessage(`{}`)) // no panic
	h.BroadcastDestroyed("x")                 // no panic
}

// TestSlowSubscriberDoesNotStallOthers — the central invariant. One
// subscriber blocks indefinitely on Send; broadcasts to all other
// subscribers still complete promptly. Eventually the slow subscriber
// is dropped via queue overflow.
func TestSlowSubscriberDoesNotStallOthers(t *testing.T) {
	t.Parallel()
	h := NewHub()

	slow := &fakeSubscriber{blockSend: make(chan struct{})}
	defer close(slow.blockSend) // unblock at test end so goroutine can exit

	fast := &fakeSubscriber{}

	h.Subscribe(slow)
	h.Subscribe(fast)

	// Drive enough broadcasts to overflow the slow queue (size 64).
	// The slow subscriber will accept the first 1 (in-flight in Send)
	// + queueSize buffered, then start dropping. The fast subscriber
	// must receive every frame.
	const N = queueSize + 32
	start := time.Now()
	for i := 0; i < N; i++ {
		h.BroadcastDestroyed("x")
	}
	elapsed := time.Since(start)

	// The broadcast loop must not have blocked on the slow subscriber.
	// Generous bound — we're really checking it didn't approach the
	// 10s WebSocket write deadline.
	if elapsed > 2*time.Second {
		t.Errorf("broadcast stalled on slow subscriber: took %v", elapsed)
	}

	// Fast subscriber receives every frame.
	waitFor(t, 2*time.Second, "fast got all frames", func() bool {
		return fast.frameCount() == N
	})

	// Slow subscriber should have been dropped via queue overflow.
	waitFor(t, 2*time.Second, "slow dropped", func() bool { return h.Count() == 1 })
}

// TestBroadcastConcurrent — many concurrent broadcasts to fast
// subscribers must deliver every frame. The per-subscriber writer is
// fast (fakeSubscriber.Send is just an append), so queues drain
// quickly and nothing overflows.
func TestBroadcastConcurrent(t *testing.T) {
	t.Parallel()
	h := NewHub()
	const subscribers = 25
	const broadcasts = 100

	var subs []*fakeSubscriber
	for i := 0; i < subscribers; i++ {
		s := &fakeSubscriber{}
		subs = append(subs, s)
		h.Subscribe(s)
	}

	var wg sync.WaitGroup
	wg.Add(broadcasts)
	for i := 0; i < broadcasts; i++ {
		go func() {
			defer wg.Done()
			h.BroadcastCreated(json.RawMessage(`{"id":"x"}`))
		}()
	}
	wg.Wait()

	for i, s := range subs {
		waitFor(t, 2*time.Second, "subscriber drained", func() bool {
			return s.frameCount() == broadcasts
		})
		if got := s.frameCount(); got != broadcasts {
			t.Errorf("subscriber %d: frameCount = %d, want %d", i, got, broadcasts)
		}
	}
}

// TestDoubleSubscribeReplacesPrior — subscribing the same Subscriber
// twice replaces the prior worker. The old goroutine exits and Close
// is called on the subscriber via that goroutine's defer. (The second
// Subscribe registers a fresh worker, so Count is still 1.)
func TestDoubleSubscribeReplacesPrior(t *testing.T) {
	t.Parallel()
	h := NewHub()
	s := &fakeSubscriber{}
	h.Subscribe(s)
	h.Subscribe(s) // replace
	if h.Count() != 1 {
		t.Errorf("Count after double-subscribe = %d, want 1", h.Count())
	}
}
