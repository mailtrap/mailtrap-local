package api

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mailtrap/mailtrap-local/internal/live"
)

const (
	wsReadBufferSize  = 1024
	wsWriteBufferSize = 4096
	wsReadDeadline    = 60 * time.Second
	wsPingInterval    = 25 * time.Second
	wsWriteDeadline   = 10 * time.Second
)

// upgrader accepts WebSocket upgrades only from loopback origins (or
// requests with no Origin, e.g. non-browser clients). A malicious site a
// developer visits would otherwise be able to open /cable cross-origin
// and stream every caught email as it arrives — the WebSocket equivalent
// of the cross-origin inbox read the HTTP CORS policy already blocks.
var upgrader = websocket.Upgrader{
	ReadBufferSize:  wsReadBufferSize,
	WriteBufferSize: wsWriteBufferSize,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return origin == "" || isLoopbackOrigin(origin)
	},
}

// cable handles GET /cable. Upgrades to a WebSocket and registers the
// connection with the Hub. Any number of browser tabs may connect.
//
// The protocol is minimal: server pushes JSON frames `{type, message}` /
// `{type, id}`. Clients send nothing (or pings, which we ack).
func (s *Server) cable(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade already wrote an error response.
		return
	}

	sub := newWSSubscriber(conn)
	s.Hub.Subscribe(sub)
	defer s.Hub.Unsubscribe(sub)

	// Read loop is just a way to detect a closed connection. We don't
	// expect inbound messages.
	_ = conn.SetReadDeadline(time.Now().Add(wsReadDeadline))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(wsReadDeadline))
		return nil
	})

	// Periodic ping to keep the connection alive through proxies.
	pingDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(wsPingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = sub.ping()
			case <-pingDone:
				return
			}
		}
	}()
	defer close(pingDone)

	for {
		if _, _, err := conn.NextReader(); err != nil {
			return
		}
	}
}

// wsSubscriber adapts a *websocket.Conn to live.Subscriber. Writes are
// serialized with a mutex (gorilla/websocket requires single-writer).
type wsSubscriber struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func newWSSubscriber(c *websocket.Conn) *wsSubscriber {
	return &wsSubscriber{conn: c}
}

func (s *wsSubscriber) Send(b []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(wsWriteDeadline))
	if err := s.conn.WriteMessage(websocket.TextMessage, b); err != nil {
		return fmt.Errorf("ws send: %w", err)
	}
	return nil
}

func (s *wsSubscriber) Close() error {
	if err := s.conn.Close(); err != nil {
		return fmt.Errorf("ws close: %w", err)
	}
	return nil
}

func (s *wsSubscriber) ping() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(wsWriteDeadline))
	if err := s.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
		return fmt.Errorf("ws ping: %w", err)
	}
	return nil
}

var _ live.Subscriber = (*wsSubscriber)(nil)
