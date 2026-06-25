package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/store"
)

const secretMaskVisible = 2

// ---------------------------------------------------------------------
// Cloud connection
// ---------------------------------------------------------------------

type cloudWire struct {
	Connected     bool            `json:"connected"`
	SandboxID     int64           `json:"sandbox_id"`
	MirrorEnabled bool            `json:"mirror_enabled"`
	APITokenHint  *string         `json:"api_token_hint"`
	Locked        map[string]bool `json:"locked,omitempty"`
	ConfigPath    *string         `json:"config_path,omitempty"`
}

func (s *Server) cloudWire(c *store.CloudConnection) cloudWire {
	cfg := s.connCfg()
	locked := config.CloudLocked(cfg.Cloud)
	w := cloudWire{
		Locked:     locked,
		ConfigPath: config.SourcePathRef(cfg),
	}
	if c == nil {
		return w
	}
	w.Connected = true
	w.SandboxID = c.SandboxID
	w.MirrorEnabled = c.MirrorEnabled
	w.APITokenHint = tokenHint(locked["api_token"], c.APIToken)
	return w
}

func (s *Server) cloudShow(w http.ResponseWriter, r *http.Request) {
	cfg := s.connCfg()
	c, err := s.Store.CloudGet(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, s.cloudWire(nil))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	tmp := *c
	applyCloudCfg(&tmp, cfg.Cloud)
	writeJSON(w, http.StatusOK, s.cloudWire(&tmp))
}

func (s *Server) cloudUpdate(w http.ResponseWriter, r *http.Request) {
	cfg := s.connCfg()
	locked := config.CloudLocked(cfg.Cloud)

	var body struct {
		APIToken      string `json:"api_token"`
		SandboxID     int64  `json:"sandbox_id"`
		MirrorEnabled bool   `json:"mirror_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "decode: "+err.Error())
		return
	}
	if locked["api_token"] && body.APIToken != "" &&
		(cfg.Cloud.APIToken == nil || body.APIToken != *cfg.Cloud.APIToken) {
		writeError(w, http.StatusUnprocessableEntity, "api_token is pinned by config")
		return
	}
	if locked["sandbox_id"] && body.SandboxID != 0 &&
		(cfg.Cloud.SandboxID == nil || body.SandboxID != *cfg.Cloud.SandboxID) {
		writeError(w, http.StatusUnprocessableEntity, "sandbox_id is pinned by config")
		return
	}
	if locked["mirror_enabled"] && cfg.Cloud.MirrorEnabled != nil &&
		body.MirrorEnabled != *cfg.Cloud.MirrorEnabled {
		writeError(w, http.StatusUnprocessableEntity, "mirror_enabled is pinned by config")
		return
	}

	// Preserve existing credentials when the caller leaves them blank — the
	// dialog only sends api_token when the user re-enters it, and a partial
	// update (e.g. toggling mirror_enabled on a connected sandbox) should
	// not require re-typing the token or sandbox ID.
	apiToken, sandboxID := body.APIToken, body.SandboxID
	mirror := body.MirrorEnabled
	if apiToken == "" || sandboxID == 0 {
		if existing, _ := s.Store.CloudGet(r.Context()); existing != nil {
			if apiToken == "" {
				apiToken = existing.APIToken
			}
			if sandboxID == 0 {
				sandboxID = existing.SandboxID
			}
		}
	}
	c := &store.CloudConnection{
		APIToken: apiToken, SandboxID: sandboxID, MirrorEnabled: mirror,
	}
	applyCloudCfg(c, cfg.Cloud)
	if c.APIToken == "" || c.SandboxID == 0 {
		writeError(w, http.StatusUnprocessableEntity, "api_token and sandbox_id are required")
		return
	}
	if err := s.Store.CloudUpsert(r.Context(), c); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.cloudWire(c))
}

func (s *Server) cloudDestroy(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.CloudDelete(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.cloudWire(nil))
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
	PasswordHint     *string         `json:"password_hint"`
	Locked           map[string]bool `json:"locked,omitempty"`
	ConfigPath       *string         `json:"config_path,omitempty"`
}

func (s *Server) relayWire(r *store.RelayConnection) relayWire {
	cfg := s.connCfg()
	locked := config.RelayLocked(cfg.Relay)
	w := relayWire{
		Locked:     locked,
		ConfigPath: config.SourcePathRef(cfg),
	}
	if r == nil {
		return w
	}
	w.Connected = true
	w.Host = r.Host
	w.Port = r.Port
	w.Username = r.Username
	w.Auth = r.Auth
	w.TLS = r.TLS
	w.AutoRelayEnabled = r.AutoRelayEnabled
	w.OverrideFrom = r.OverrideFrom
	w.ReturnPath = r.ReturnPath
	w.PasswordHint = secretHint(locked["password"], r.Password)
	return w
}

func (s *Server) relayShow(w http.ResponseWriter, r *http.Request) {
	cfg := s.connCfg()
	rc, err := s.Store.RelayGet(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, s.relayWire(nil))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	tmp := *rc
	applyRelayCfg(&tmp, cfg.Relay)
	writeJSON(w, http.StatusOK, s.relayWire(&tmp))
}

func (s *Server) relayUpdate(w http.ResponseWriter, r *http.Request) {
	cfg := s.connCfg()
	locked := config.RelayLocked(cfg.Relay)

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
	if locked["host"] && body.Host != "" &&
		(cfg.Relay.Host == nil || body.Host != *cfg.Relay.Host) {
		writeError(w, http.StatusUnprocessableEntity, "host is pinned by config")
		return
	}
	if locked["port"] && body.Port != 0 &&
		(cfg.Relay.Port == nil || body.Port != *cfg.Relay.Port) {
		writeError(w, http.StatusUnprocessableEntity, "port is pinned by config")
		return
	}
	if locked["username"] && body.Username != "" &&
		(cfg.Relay.Username == nil || body.Username != *cfg.Relay.Username) {
		writeError(w, http.StatusUnprocessableEntity, "username is pinned by config")
		return
	}
	if locked["password"] && body.Password != "" &&
		(cfg.Relay.Password == nil || body.Password != *cfg.Relay.Password) {
		writeError(w, http.StatusUnprocessableEntity, "password is pinned by config")
		return
	}
	if locked["auth"] && body.Auth != "" &&
		(cfg.Relay.Auth == nil || body.Auth != *cfg.Relay.Auth) {
		writeError(w, http.StatusUnprocessableEntity, "auth is pinned by config")
		return
	}
	if locked["tls"] && body.TLS != "" &&
		(cfg.Relay.TLS == nil || body.TLS != *cfg.Relay.TLS) {
		writeError(w, http.StatusUnprocessableEntity, "tls is pinned by config")
		return
	}
	if locked["override_from"] && body.OverrideFrom != "" &&
		(cfg.Relay.OverrideFrom == nil || body.OverrideFrom != *cfg.Relay.OverrideFrom) {
		writeError(w, http.StatusUnprocessableEntity, "override_from is pinned by config")
		return
	}
	if locked["return_path"] && body.ReturnPath != "" &&
		(cfg.Relay.ReturnPath == nil || body.ReturnPath != *cfg.Relay.ReturnPath) {
		writeError(w, http.StatusUnprocessableEntity, "return_path is pinned by config")
		return
	}

	host := body.Host
	if host == "" {
		if existing, _ := s.Store.RelayGet(r.Context()); existing != nil {
			host = existing.Host
		}
	}
	if host == "" && cfg.Relay.Host != nil {
		host = *cfg.Relay.Host
	}
	if host == "" {
		writeError(w, http.StatusUnprocessableEntity, "host is required")
		return
	}

	port := body.Port
	if port == 0 {
		if existing, _ := s.Store.RelayGet(r.Context()); existing != nil && existing.Port != 0 {
			port = existing.Port
		}
	}
	if port == 0 {
		port = 587
	}
	auth, tls := body.Auth, body.TLS
	if auth == "" {
		auth = "plain"
	}
	if tls == "" {
		tls = "auto"
	}

	password := body.Password
	if password == "" {
		if existing, _ := s.Store.RelayGet(r.Context()); existing != nil {
			password = existing.Password
		}
	}

	rc := &store.RelayConnection{
		Host: host, Port: port,
		Username: body.Username, Password: password,
		Auth: auth, TLS: tls,
		AutoRelayEnabled: body.AutoRelayEnabled,
		OverrideFrom:     body.OverrideFrom, ReturnPath: body.ReturnPath,
	}
	applyRelayCfg(rc, cfg.Relay)
	if err := s.Store.RelayUpsert(r.Context(), rc); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.relayWire(rc))
}

func (s *Server) relayDestroy(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.RelayDelete(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.relayWire(nil))
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

	if err := s.Relay.Probe(r.Context(), body.Host, body.Port,
		body.Username, body.Password, body.Auth, body.TLS); err != nil {
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

func (s *Server) webhookWire(wc *store.WebhookConnection) webhookWire {
	cfg := s.connCfg()
	locked := config.WebhookLocked(cfg.Webhook)
	out := webhookWire{
		Locked:     locked,
		ConfigPath: config.SourcePathRef(cfg),
	}
	if wc == nil {
		return out
	}
	out.Connected = true
	out.URL = wc.URL
	out.Enabled = wc.Enabled
	out.SecretHint = secretHint(locked["secret"], wc.Secret)
	return out
}

func (s *Server) webhookShow(w http.ResponseWriter, r *http.Request) {
	cfg := s.connCfg()
	wc, err := s.Store.WebhookGet(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, s.webhookWire(nil))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	tmp := *wc
	applyWebhookCfg(&tmp, cfg.Webhook)
	writeJSON(w, http.StatusOK, s.webhookWire(&tmp))
}

func lastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func (s *Server) webhookUpdate(w http.ResponseWriter, r *http.Request) {
	cfg := s.connCfg()
	locked := config.WebhookLocked(cfg.Webhook)

	var body struct {
		URL     string  `json:"url"`
		Secret  *string `json:"secret"`
		Enabled bool    `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "decode: "+err.Error())
		return
	}
	if locked["url"] && body.URL != "" &&
		(cfg.Webhook.URL == nil || body.URL != *cfg.Webhook.URL) {
		writeError(w, http.StatusUnprocessableEntity, "url is pinned by config")
		return
	}
	if locked["secret"] && body.Secret != nil &&
		(cfg.Webhook.Secret == nil || *body.Secret != *cfg.Webhook.Secret) {
		writeError(w, http.StatusUnprocessableEntity, "secret is pinned by config")
		return
	}

	url := body.URL
	if url == "" {
		if existing, _ := s.Store.WebhookGet(r.Context()); existing != nil {
			url = existing.URL
		}
	}
	if url == "" && cfg.Webhook.URL != nil {
		url = *cfg.Webhook.URL
	}
	if url == "" {
		writeError(w, http.StatusUnprocessableEntity, "url is required")
		return
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		writeError(w, http.StatusUnprocessableEntity, "url must be http(s)://")
		return
	}

	secret := ""
	if body.Secret != nil {
		secret = *body.Secret
	} else {
		if existing, _ := s.Store.WebhookGet(r.Context()); existing != nil {
			secret = existing.Secret
		}
	}

	wc := &store.WebhookConnection{URL: url, Secret: secret, Enabled: body.Enabled}
	applyWebhookCfg(wc, cfg.Webhook)
	if err := s.Store.WebhookUpsert(r.Context(), wc); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.webhookWire(wc))
}

func (s *Server) webhookDestroy(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.WebhookDelete(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.webhookWire(nil))
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
