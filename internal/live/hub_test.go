package live

import (
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

// fakeSubscriber records every Send and reports counts. The optional
// `failOnSend` flag makes Send return an error so we can exercise the
// "drop subscriber on send failure" path.
type fakeSubscriber struct {
	mu         sync.Mutex
	frames     [][]byte
	closed     atomic.Bool
	failOnSend bool
}

func (f *fakeSubscriber) Send(b []byte) error {
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
	if !s.closed.Load() {
		t.Errorf("Unsubscribe should call Close() on the subscriber")
	}
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
		if s.frameCount() != 1 {
			t.Errorf("subscriber %s: frameCount = %d, want 1", name, s.frameCount())
		}
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

	if s.frameCount() != 1 {
		t.Fatalf("frameCount = %d, want 1", s.frameCount())
	}
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

	if h.Count() != 1 {
		t.Errorf("after broadcast with failing sub: Count() = %d, want 1", h.Count())
	}
	if !broken.closed.Load() {
		t.Errorf("broken subscriber should have been Closed by Unsubscribe")
	}
	if healthy.frameCount() != 1 {
		t.Errorf("healthy subscriber lost a frame because of broken peer: count = %d, want 1",
			healthy.frameCount())
	}

	// A second broadcast still reaches healthy.
	h.BroadcastDestroyed("x")
	if healthy.frameCount() != 2 {
		t.Errorf("healthy subscriber: post-drop frameCount = %d, want 2", healthy.frameCount())
	}
}

// TestBroadcastWithNoSubscribers — broadcasting against an empty hub
// must not panic or block.
func TestBroadcastWithNoSubscribers(t *testing.T) {
	t.Parallel()
	h := NewHub()
	h.BroadcastCreated(json.RawMessage(`{}`)) // no panic
	h.BroadcastDestroyed("x")                 // no panic
}

// TestBroadcastConcurrent — many concurrent broadcasts + subscribes
// shouldn't trip the race detector or drop frames spuriously. The key
// invariant: a subscriber that's already in the set when the broadcast
// loop snapshots `subs` always gets the frame.
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
		if s.frameCount() != broadcasts {
			t.Errorf("subscriber %d: frameCount = %d, want %d",
				i, s.frameCount(), broadcasts)
		}
	}
}
