// Package live is the in-process pub-sub for SPA live updates.
//
// Tiny WebSocket fan-out: any number of subscribed browsers receive
// `created` / `destroyed` events the moment the store mutates.
//
// Wire format is intentionally minimal — frontend consumes plain JSON
// frames, no subscription handshake protocol:
//
//	{ "type": "created",   "message": { ... MessageSummary ... } }
//	{ "type": "destroyed", "id":      "<message-id>" }
//
// Concurrency: each subscriber gets a bounded queue (chan []byte) and a
// writer goroutine that drains the queue and calls Send. Broadcasts do
// a non-blocking send to each queue; if a subscriber's queue is full,
// the hub drops that subscriber rather than stalling the broadcast.
// This is the textbook fan-out pattern — one slow consumer can't hold
// up the others.
package live

import (
	"encoding/json"
	"sync"
	"time"
)

// Tuning knobs:
//
//	queueSize    per-subscriber buffer; absorbs bursts of created /
//	             destroyed events without dropping
//	pushTimeout  how long broadcast waits on a full queue before
//	             deciding the subscriber is too slow. Long enough to
//	             ride out scheduler hiccups under concurrent broadcast
//	             load; short enough that an actually-stuck consumer
//	             gets evicted promptly.
const (
	queueSize   = 64
	pushTimeout = 50 * time.Millisecond
)

// Subscriber is the destination for events. The Hub never blocks on a
// slow subscriber: if Send returns an error, or if the subscriber's
// queue overflows, the subscriber is dropped from the broadcast set
// and Close is called.
type Subscriber interface {
	Send(msg []byte) error
	Close() error
}

// Hub owns the subscriber set and broadcasts events to all of them.
// Safe for concurrent use.
type Hub struct {
	mu   sync.Mutex
	subs map[Subscriber]*subWorker
}

// subWorker owns the per-subscriber queue + writer goroutine.
type subWorker struct {
	sub   Subscriber
	queue chan []byte
	// stop is closed exactly once (by Unsubscribe or by an overflow
	// drop) to signal the writer to return. The hub guards against
	// double-close by re-checking the subscriber's presence in the
	// map under the lock before closing.
	stop chan struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[Subscriber]*subWorker)}
}

// Subscribe adds a subscriber and starts its writer goroutine. Caller
// is responsible for calling Unsubscribe (typically deferred at the
// end of the WebSocket loop). Calling Subscribe twice with the same
// Subscriber replaces the prior worker.
func (h *Hub) Subscribe(s Subscriber) {
	w := &subWorker{
		sub:   s,
		queue: make(chan []byte, queueSize),
		stop:  make(chan struct{}),
	}
	h.mu.Lock()
	// If the same Subscriber is re-registered, replace the old worker.
	// The old stop channel gets closed below so the old goroutine exits.
	if old, ok := h.subs[s]; ok {
		close(old.stop)
	}
	h.subs[s] = w
	h.mu.Unlock()
	go h.runWriter(w)
}

// Unsubscribe removes a subscriber. The writer goroutine exits and
// calls Close on the Subscriber. Idempotent.
func (h *Hub) Unsubscribe(s Subscriber) {
	h.mu.Lock()
	w, ok := h.subs[s]
	if ok {
		delete(h.subs, s)
	}
	h.mu.Unlock()
	if ok {
		close(w.stop)
	}
}

// BroadcastCreated fans out a "created" event with the given JSON-
// encoded MessageSummary payload.
func (h *Hub) BroadcastCreated(summaryJSON json.RawMessage) {
	frame, err := json.Marshal(struct {
		Type    string          `json:"type"`
		Message json.RawMessage `json:"message"`
	}{Type: "created", Message: summaryJSON})
	if err != nil {
		return
	}
	h.broadcast(frame)
}

// BroadcastDestroyed fans out a "destroyed" event for the given ID.
func (h *Hub) BroadcastDestroyed(id string) {
	frame, err := json.Marshal(struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	}{Type: "destroyed", ID: id})
	if err != nil {
		return
	}
	h.broadcast(frame)
}

// Count returns the current subscriber count (useful for tests + a
// future ops endpoint).
func (h *Hub) Count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

func (h *Hub) broadcast(frame []byte) {
	h.mu.Lock()
	workers := make([]*subWorker, 0, len(h.subs))
	for _, w := range h.subs {
		workers = append(workers, w)
	}
	h.mu.Unlock()
	for _, w := range workers {
		// Try a non-blocking send first — the common case. If the
		// queue's full, wait briefly to ride out scheduler hiccups
		// (multiple concurrent broadcasts can briefly starve a single
		// writer). Only an actually-stuck consumer overflows the
		// timeout and gets dropped.
		select {
		case w.queue <- frame:
			continue
		default:
		}
		t := time.NewTimer(pushTimeout)
		select {
		case w.queue <- frame:
			t.Stop()
		case <-t.C:
			h.dropSlow(w)
		}
	}
}

// dropSlow removes an overflowed subscriber from the set and stops its
// writer. Safe to call concurrently with Unsubscribe (both check the
// map under the lock before closing stop, so close happens exactly
// once).
func (h *Hub) dropSlow(w *subWorker) {
	h.mu.Lock()
	still := h.subs[w.sub] == w
	if still {
		delete(h.subs, w.sub)
	}
	h.mu.Unlock()
	if still {
		close(w.stop)
	}
}

// runWriter pulls frames from the queue and forwards them to the
// Subscriber. Exits on stop close or on a Send error. Always Close()s
// the Subscriber on exit.
func (h *Hub) runWriter(w *subWorker) {
	defer func() { _ = w.sub.Close() }()
	for {
		select {
		case <-w.stop:
			return
		case frame := <-w.queue:
			if err := w.sub.Send(frame); err != nil {
				// Send error — drop self. Re-check the map: if the
				// subscriber is still registered, remove it; this
				// path is the only one that drops on Send failure
				// (vs the broadcast overflow path which drops on
				// queue-full).
				h.mu.Lock()
				if h.subs[w.sub] == w {
					delete(h.subs, w.sub)
				}
				h.mu.Unlock()
				return
			}
		}
	}
}
