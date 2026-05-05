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
package live

import (
	"encoding/json"
	"sync"
)

// Subscriber is the destination for events. The Hub never blocks on a
// slow subscriber: if `Send` returns an error, the subscriber is
// dropped from the broadcast set.
type Subscriber interface {
	Send([]byte) error
	Close() error
}

// Hub owns the subscriber set and broadcasts events to all of them.
// Safe for concurrent use.
type Hub struct {
	mu   sync.Mutex
	subs map[Subscriber]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[Subscriber]struct{})}
}

// Subscribe adds a subscriber. Caller is responsible for calling
// Unsubscribe (typically deferred at the end of the WebSocket loop).
func (h *Hub) Subscribe(s Subscriber) {
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
}

// Unsubscribe removes a subscriber and closes it.
func (h *Hub) Unsubscribe(s Subscriber) {
	h.mu.Lock()
	delete(h.subs, s)
	h.mu.Unlock()
	_ = s.Close()
}

// BroadcastCreated fans out a "created" event with the given JSON-
// encoded MessageSummary payload.
func (h *Hub) BroadcastCreated(summaryJSON json.RawMessage) {
	frame, _ := json.Marshal(struct {
		Type    string          `json:"type"`
		Message json.RawMessage `json:"message"`
	}{Type: "created", Message: summaryJSON})
	h.broadcast(frame)
}

// BroadcastDestroyed fans out a "destroyed" event for the given ID.
func (h *Hub) BroadcastDestroyed(id string) {
	frame, _ := json.Marshal(struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	}{Type: "destroyed", ID: id})
	h.broadcast(frame)
}

func (h *Hub) broadcast(frame []byte) {
	h.mu.Lock()
	subs := make([]Subscriber, 0, len(h.subs))
	for s := range h.subs {
		subs = append(subs, s)
	}
	h.mu.Unlock()
	for _, s := range subs {
		if err := s.Send(frame); err != nil {
			h.Unsubscribe(s)
		}
	}
}

// Count returns the current subscriber count (useful for tests + a
// future ops endpoint).
func (h *Hub) Count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}
