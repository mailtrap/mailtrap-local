package api

import (
	"encoding/json"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/live"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
)

const (
	defaultLimit = 50
	maxLimit     = 200
)

// Server is the HTTP layer. Holds every dependency the handlers reach
// for, so handlers stay pure functions of the request.
type Server struct {
	Store    *store.Store
	Hub      *live.Hub
	Relay    *relay.Client
	Webhook  *webhook.Client
	Config   *config.Loader
	Frontend fs.FS // production: embedded SPA dist; dev: nil (Vite serves it)
	OpenAPI  []byte

	// OnIngest fires after a successful POST /api/v1/ingest. Wired by
	// main.go to trigger the dispatcher (cloud mirror / relay mirror /
	// webhook delivery / retention / live broadcast).
	OnIngest func(msgID string)
}

// Router builds the chi router. Caller hands it to http.ListenAndServe.
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()

	// nosniff on every response — the app serves attacker-controlled
	// content (caught email bodies + attachments), so browsers must not
	// be allowed to MIME-sniff a part's bytes into an executable type.
	r.Use(securityHeaders)

	// CORS, scoped to loopback origins only. The SPA is same-origin so it
	// needs no CORS; this exists only so raw fetches from a developer's
	// own machine (browser console, Vite dev on :3540) work.
	r.Use(corsLoopback)

	// WebSocket lives outside /api/v1 because frontends often hardcode
	// "/cable" (matching the historical mount path).
	r.Get("/cable", s.cable)

	r.Route("/api/v1", func(r chi.Router) {
		// Per-request structured-log middleware. Lives only on /api/v1
		// (not the SPA static handler) — no point logging every CSS
		// asset GET. Injects a logger into the request context with
		// rid + method + path, and emits one access-log line per
		// request with status + duration.
		r.Use(requestLogger)

		// Bare /api/v1 — redirect a human-loading the URL straight
		// to the docs site rather than 404'ing them.
		r.Get("/", s.docsRedirect)
		r.Get("/openapi.yaml", s.openapiYAML)

		// Internal — same JSON contract the smtpd-as-sidecar used to
		// post against. Kept as an HTTP endpoint so tests can drive
		// ingest without spinning up an SMTP listener.
		r.Post("/ingest", s.ingest)

		// Messages list/bulk
		r.Get("/messages", s.listMessages)
		r.Put("/messages", s.updateRead)
		r.Delete("/messages", s.destroyMessages)

		r.Get("/search", s.search)

		// Per-message
		r.Route("/message/{id}", func(r chi.Router) {
			r.Get("/", s.getMessage)
			r.Get("/raw", s.rawMessage)
			r.Get("/headers", s.headers)
			r.Get("/part/{part_id}", s.part)
			r.Get("/html_check", s.htmlCheck)
			r.Post("/release", s.release)
			r.Post("/send_to_cloud", s.sendToCloud)
		})

		// Cloud connection (singleton CRUD)
		r.Get("/cloud_connection", s.cloudShow)
		r.Put("/cloud_connection", s.cloudUpdate)
		r.Delete("/cloud_connection", s.cloudDestroy)

		// Relay connection (singleton CRUD + test)
		r.Get("/relay_connection", s.relayShow)
		r.Put("/relay_connection", s.relayUpdate)
		r.Delete("/relay_connection", s.relayDestroy)
		r.Post("/relay_connection/test", s.relayTest)

		// Webhook connection (singleton CRUD + test)
		r.Get("/webhook_connection", s.webhookShow)
		r.Put("/webhook_connection", s.webhookUpdate)
		r.Delete("/webhook_connection", s.webhookDestroy)
		r.Post("/webhook_connection/test", s.webhookTest)
	})

	// Frontend SPA — anything that didn't match an API route. In dev
	// (Frontend nil) returns 404 and the user hits Vite directly.
	if s.Frontend != nil {
		r.Handle("/*", spaHandler(s.Frontend))
	}

	return r
}

// ---------------------------------------------------------------------
// Common handlers + helpers
// ---------------------------------------------------------------------

// ingest is consumed by the in-process SMTP layer (and by tests).
// Persists the IngestPayload, then dispatches the side-effect jobs +
// the live `created` broadcast via the wired callback (set in main.go).
func (s *Server) ingest(w http.ResponseWriter, r *http.Request) {
	var p store.IngestPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeError(w, http.StatusBadRequest, "decode payload: "+err.Error())
		return
	}
	id, err := s.Store.Insert(r.Context(), &p)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if s.OnIngest != nil {
		s.OnIngest(id)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(map[string]string{"ID": id}); err != nil {
		return
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		return
	}
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, ErrorResponse{Error: msg})
}

func parseInt(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func clamp(n, lo, hi int) int {
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

// securityHeaders sets headers applied to every response. nosniff is the
// important one: the API serves attacker-controlled bytes (email parts),
// and without it a browser could sniff a part declared text/plain into
// text/html and execute it in the app origin.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// corsLoopback reflects CORS headers only when the request Origin is a
// loopback address. A wildcard Access-Control-Allow-Origin (the previous
// behaviour) let *any* website a developer happened to visit read and
// mutate the local inbox cross-origin — read every caught email, wipe
// the mailbox, repoint the webhook. Echoing only loopback origins keeps
// the dev-console / Vite-proxy convenience without that exposure.
func corsLoopback(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && isLoopbackOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isLoopbackOrigin reports whether an Origin header value
// (e.g. "http://127.0.0.1:3540") points at a loopback host.
func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// spaHandler serves the SPA dist with a single-page fallback: any path
// that doesn't match a real file falls through to /index.html so the
// React router handles the deep-link itself.
func spaHandler(root fs.FS) http.Handler {
	fileServer := http.FileServerFS(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// If the requested path doesn't exist, rewrite to /index.html.
		if _, err := fs.Stat(root, r.URL.Path[1:]); err != nil && r.URL.Path != "/" {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
