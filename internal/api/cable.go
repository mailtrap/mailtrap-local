package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mailtrap/mailtrap-local/internal/live"
)

// upgrader allows any origin — this is a localhost-only dev tool, no
// CSRF risk worth defending against.
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin:     func(*http.Request) bool { return true },
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
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Periodic ping to keep the connection alive through proxies.
	pingDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(25 * time.Second)
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
	_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return s.conn.WriteMessage(websocket.TextMessage, b)
}

func (s *wsSubscriber) ping() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return s.conn.WriteMessage(websocket.PingMessage, nil)
}

func (s *wsSubscriber) Close() error {
	return s.conn.Close()
}

var _ live.Subscriber = (*wsSubscriber)(nil)
