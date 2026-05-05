package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/mailtrap/mailtrap-local/internal/store"
)

// ---------------------------------------------------------------------
// Cloud connection
// ---------------------------------------------------------------------

type cloudWire struct {
	Connected     bool            `json:"connected"`
	SandboxID     int64           `json:"sandbox_id"`
	MirrorEnabled bool            `json:"mirror_enabled"`
	Locked        map[string]bool `json:"locked,omitempty"`
	ConfigPath    *string         `json:"config_path,omitempty"`
}

func (s *Server) cloudShow(w http.ResponseWriter, r *http.Request) {
	c, err := s.Store.CloudGet(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, cloudWire{Connected: false})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cloudWire{
		Connected: true, SandboxID: c.SandboxID, MirrorEnabled: c.MirrorEnabled,
	})
}

func (s *Server) cloudUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		APIToken      string `json:"api_token"`
		SandboxID     int64  `json:"sandbox_id"`
		MirrorEnabled bool   `json:"mirror_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "decode: "+err.Error())
		return
	}
	if body.APIToken == "" || body.SandboxID == 0 {
		writeError(w, http.StatusUnprocessableEntity, "api_token and sandbox_id are required")
		return
	}
	c := &store.CloudConnection{
		APIToken: body.APIToken, SandboxID: body.SandboxID, MirrorEnabled: body.MirrorEnabled,
	}
	if err := s.Store.CloudUpsert(r.Context(), c); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cloudWire{
		Connected: true, SandboxID: c.SandboxID, MirrorEnabled: c.MirrorEnabled,
	})
}

func (s *Server) cloudDestroy(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.CloudDelete(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cloudWire{Connected: false})
}

// ---------------------------------------------------------------------
// Relay connection
// ---------------------------------------------------------------------

type relayWire struct {
	Connected        bool            `json:"connected"`
	Host             string          `json:"host,omitempty"`
	Port             int             `json:"port,omitempty"`
	Username         string          `json:"username,omitempty"`
	Auth             string          `json:"auth,omitempty"`
	TLS              string          `json:"tls,omitempty"`
	AutoRelayEnabled bool            `json:"auto_relay_enabled"`
	OverrideFrom     string          `json:"override_from,omitempty"`
	ReturnPath       string          `json:"return_path,omitempty"`
	Locked           map[string]bool `json:"locked,omitempty"`
	ConfigPath       *string         `json:"config_path,omitempty"`
}

func toRelayWire(r *store.RelayConnection) relayWire {
	if r == nil {
		return relayWire{Connected: false}
	}
	return relayWire{
		Connected:        true,
		Host:             r.Host,
		Port:             r.Port,
		Username:         r.Username,
		Auth:             r.Auth,
		TLS:              r.TLS,
		AutoRelayEnabled: r.AutoRelayEnabled,
		OverrideFrom:     r.OverrideFrom,
		ReturnPath:       r.ReturnPath,
	}
}

func (s *Server) relayShow(w http.ResponseWriter, r *http.Request) {
	rc, err := s.Store.RelayGet(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, relayWire{Connected: false})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toRelayWire(rc))
}

func (s *Server) relayUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Host             string `json:"host"`
		Port             int    `json:"port"`
		Username         string `json:"username"`
		Password         string `json:"password"`
		Auth             string `json:"auth"`
		TLS              string `json:"tls"`
		AutoRelayEnabled bool   `json:"auto_relay_enabled"`
		OverrideFrom     string `json:"override_from"`
		ReturnPath       string `json:"return_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "decode: "+err.Error())
		return
	}
	if body.Host == "" {
		writeError(w, http.StatusUnprocessableEntity, "host is required")
		return
	}
	if body.Port == 0 {
		body.Port = 587
	}
	if body.Auth == "" {
		body.Auth = "plain"
	}
	if body.TLS == "" {
		body.TLS = "auto"
	}

	// Preserve existing password when caller leaves it blank (the
	// dialog sends "" when the user hasn't re-entered it).
	password := body.Password
	if password == "" {
		if existing, _ := s.Store.RelayGet(r.Context()); existing != nil {
			password = existing.Password
		}
	}

	rc := &store.RelayConnection{
		Host: body.Host, Port: body.Port,
		Username: body.Username, Password: password,
		Auth: body.Auth, TLS: body.TLS,
		AutoRelayEnabled: body.AutoRelayEnabled,
		OverrideFrom:     body.OverrideFrom, ReturnPath: body.ReturnPath,
	}
	if err := s.Store.RelayUpsert(r.Context(), rc); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toRelayWire(rc))
}

func (s *Server) relayDestroy(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.RelayDelete(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, relayWire{Connected: false})
}

// relayTest probes the relay reachability. Body: { host, port, username,
// password, auth, tls, ... }; falls back to saved password if blank.
func (s *Server) relayTest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Host     string `json:"host"`
		Port     int    `json:"port"`
		Username string `json:"username"`
		Password string `json:"password"`
		Auth     string `json:"auth"`
		TLS      string `json:"tls"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "decode: "+err.Error())
		return
	}
	if body.Host == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "host required"})
		return
	}
	if body.Password == "" {
		if existing, _ := s.Store.RelayGet(r.Context()); existing != nil {
			body.Password = existing.Password
		}
	}
	if body.Port == 0 {
		body.Port = 587
	}
	if body.Auth == "" {
		body.Auth = "plain"
	}
	if body.TLS == "" {
		body.TLS = "auto"
	}

	if err := s.Relay.Probe(context.Background(), body.Host, body.Port, body.Username, body.Password, body.Auth, body.TLS); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Connected and authenticated."})
}

// ---------------------------------------------------------------------
// Webhook connection
// ---------------------------------------------------------------------

type webhookWire struct {
	Connected  bool            `json:"connected"`
	URL        string          `json:"url,omitempty"`
	Enabled    bool            `json:"enabled"`
	SecretHint *string         `json:"secret_hint"`
	Locked     map[string]bool `json:"locked,omitempty"`
	ConfigPath *string         `json:"config_path,omitempty"`
}

func toWebhookWire(w *store.WebhookConnection) webhookWire {
	if w == nil {
		return webhookWire{Connected: false, SecretHint: nil}
	}
	var hint *string
	if w.Secret != "" {
		s := "••••" + lastN(w.Secret, 2)
		hint = &s
	}
	return webhookWire{
		Connected: true, URL: w.URL, Enabled: w.Enabled, SecretHint: hint,
	}
}

func lastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func (s *Server) webhookShow(w http.ResponseWriter, r *http.Request) {
	wc, err := s.Store.WebhookGet(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, webhookWire{Connected: false, SecretHint: nil})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toWebhookWire(wc))
}

func (s *Server) webhookUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL     string  `json:"url"`
		Secret  *string `json:"secret"`
		Enabled bool    `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "decode: "+err.Error())
		return
	}
	if body.URL == "" {
		writeError(w, http.StatusUnprocessableEntity, "url is required")
		return
	}
	if !strings.HasPrefix(body.URL, "http://") && !strings.HasPrefix(body.URL, "https://") {
		writeError(w, http.StatusUnprocessableEntity, "url must be http(s)://")
		return
	}

	// Secret nil → preserve existing; "" → clear; non-empty → set.
	secret := ""
	if body.Secret != nil {
		secret = *body.Secret
	} else {
		if existing, _ := s.Store.WebhookGet(r.Context()); existing != nil {
			secret = existing.Secret
		}
	}

	wc := &store.WebhookConnection{URL: body.URL, Secret: secret, Enabled: body.Enabled}
	if err := s.Store.WebhookUpsert(r.Context(), wc); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toWebhookWire(wc))
}

func (s *Server) webhookDestroy(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.WebhookDelete(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, webhookWire{Connected: false, SecretHint: nil})
}

// webhookTest sends a synthetic ping payload with the same headers and
// signing scheme the real delivery job uses.
func (s *Server) webhookTest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL    string `json:"url"`
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "decode: "+err.Error())
		return
	}
	if body.URL == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "URL is required"})
		return
	}
	if body.Secret == "" {
		if existing, _ := s.Store.WebhookGet(r.Context()); existing != nil {
			body.Secret = existing.Secret
		}
	}

	if err := s.Webhook.SendTestPing(r.Context(), body.URL, body.Secret); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "POST " + body.URL + " → 2xx"})
}
