package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mailtrap/mailtrap-local/internal/cloud"
	"github.com/mailtrap/mailtrap-local/internal/htmlcheck"
	"github.com/mailtrap/mailtrap-local/internal/store"
)

const releaseTimeout = 30 * time.Second

// release handles POST /api/v1/message/:id/release. Body { to: [...] }.
// Forwards through the configured SMTP relay.
func (s *Server) release(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		To []string `json:"to"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		return
	}
	tos := nonBlank(body.To)
	if len(tos) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "to must include at least one address")
		return
	}

	m, err := s.Store.Get(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Message not found")
		return
	}
	if err != nil {
		writeInternalError(w, r, err)
		return
	}

	conn, err := s.Store.RelayGet(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusServiceUnavailable, "No SMTP relay configured. Configure one from the sidebar.")
		return
	}
	if err != nil {
		writeInternalError(w, r, err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), releaseTimeout)
	defer cancel()
	// rewriteTo=true: this is a manual release, so the delivered copy
	// should read as addressed to whoever the user released it to.
	if err := s.Relay.Forward(ctx, conn, m, tos, true); err != nil {
		writeError(w, http.StatusBadGateway, "SMTP relay failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "host": conn.Host, "to": tos,
	})
}

// sendToCloud handles POST /api/v1/message/:id/send_to_cloud.
func (s *Server) sendToCloud(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	m, err := s.Store.Get(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Message not found")
		return
	}
	if err != nil {
		writeInternalError(w, r, err)
		return
	}

	conn, err := s.Store.CloudGet(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusServiceUnavailable, "No cloud sandbox connected. Connect from the sidebar first.")
		return
	}
	if err != nil {
		writeInternalError(w, r, err)
		return
	}

	inline, _ := s.Store.LoadInline(r.Context(), m.ID)
	atts, _ := s.Store.LoadAttachments(r.Context(), m.ID)

	cl := cloud.NewClient(conn.APIToken, conn.SandboxID)
	if s.CloudBaseURL != "" {
		cl.BaseURL = s.CloudBaseURL
	}
	if err := cl.Send(r.Context(), m, inline, atts); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ok"))
}

// htmlCheck handles GET /api/v1/message/:id/html_check. Runs the rule
// engine over the message HTML and returns issues + per-family support
// percentages. Caches per-message via a tiny in-memory cache (HTML
// never mutates after ingest, so the report doesn't either).
func (s *Server) htmlCheck(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	m, err := s.Store.Get(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Message not found")
		return
	}
	if err != nil {
		writeInternalError(w, r, err)
		return
	}
	if m.HTML == "" {
		writeJSON(w, http.StatusOK, map[string]any{"status": "no_html"})
		return
	}
	const sizeLimit = 1 << 20 // 1 MiB; refuse pathological inputs
	if len(m.HTML) > sizeLimit {
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "size_limit_exceeded", "limit": sizeLimit,
		})
		return
	}
	report := htmlcheck.Run(m.HTML)
	writeJSON(w, http.StatusOK, report)
}
