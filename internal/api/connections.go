package api

import (
	"context"
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
	return storedConnectionWire(cfg, locked, c,
		func(locked map[string]bool, configPath *string) cloudWire {
			return cloudWire{Locked: locked, ConfigPath: configPath}
		},
		func(w cloudWire, c *store.CloudConnection, locked map[string]bool) cloudWire {
			w.Connected = true
			w.SandboxID = c.SandboxID
			w.MirrorEnabled = c.MirrorEnabled
			w.APITokenHint = tokenHint(locked["api_token"], c.APIToken)
			return w
		},
	)
}

func (s *Server) cloudUpdate(w http.ResponseWriter, r *http.Request) {
	cfg := s.connCfg()
	locked := config.CloudLocked(cfg.Cloud)

	var body struct {
		APIToken      string `json:"api_token"`
		SandboxID     int64  `json:"sandbox_id"`
		MirrorEnabled *bool  `json:"mirror_enabled"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		return
	}
	if locked["api_token"] && body.APIToken != "" &&
		(cfg.Cloud.APIToken == nil || body.APIToken != *cfg.Cloud.APIToken) {
		writeError(w, http.StatusUnprocessableEntity, "api_token is locked by config")
		return
	}
	if locked["sandbox_id"] && body.SandboxID != 0 &&
		(cfg.Cloud.SandboxID == nil || body.SandboxID != *cfg.Cloud.SandboxID) {
		writeError(w, http.StatusUnprocessableEntity, "sandbox_id is locked by config")
		return
	}
	if locked["mirror_enabled"] && cfg.Cloud.MirrorEnabled != nil &&
		body.MirrorEnabled != nil && *body.MirrorEnabled != *cfg.Cloud.MirrorEnabled {
		writeError(w, http.StatusUnprocessableEntity, "mirror_enabled is locked by config")
		return
	}

	// Preserve existing credentials when the caller leaves them blank — the
	// dialog only sends api_token when the user re-enters it, and a partial
	// update (e.g. toggling mirror_enabled on a connected sandbox) should
	// not require re-typing the token or sandbox ID.
	apiToken, sandboxID := body.APIToken, body.SandboxID
	var mirror bool
	if body.MirrorEnabled != nil {
		mirror = *body.MirrorEnabled
	} else if existing, _ := s.Store.CloudGet(r.Context()); existing != nil {
		mirror = existing.MirrorEnabled
	}
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
	config.OverlayCloud(c, cfg.Cloud)
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
	return storedConnectionWire(cfg, locked, r,
		func(locked map[string]bool, configPath *string) relayWire {
			return relayWire{Locked: locked, ConfigPath: configPath}
		},
		func(w relayWire, r *store.RelayConnection, locked map[string]bool) relayWire {
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
		},
	)
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
	if err := decodeJSON(w, r, &body); err != nil {
		return
	}
	if locked["host"] && body.Host != "" &&
		(cfg.Relay.Host == nil || body.Host != *cfg.Relay.Host) {
		writeError(w, http.StatusUnprocessableEntity, "host is locked by config")
		return
	}
	if locked["port"] && body.Port != 0 &&
		(cfg.Relay.Port == nil || body.Port != *cfg.Relay.Port) {
		writeError(w, http.StatusUnprocessableEntity, "port is locked by config")
		return
	}
	if locked["username"] && body.Username != "" &&
		(cfg.Relay.Username == nil || body.Username != *cfg.Relay.Username) {
		writeError(w, http.StatusUnprocessableEntity, "username is locked by config")
		return
	}
	if locked["password"] && body.Password != "" &&
		(cfg.Relay.Password == nil || body.Password != *cfg.Relay.Password) {
		writeError(w, http.StatusUnprocessableEntity, "password is locked by config")
		return
	}
	if locked["auth"] && body.Auth != "" &&
		(cfg.Relay.Auth == nil || body.Auth != *cfg.Relay.Auth) {
		writeError(w, http.StatusUnprocessableEntity, "auth is locked by config")
		return
	}
	if locked["tls"] && body.TLS != "" &&
		(cfg.Relay.TLS == nil || body.TLS != *cfg.Relay.TLS) {
		writeError(w, http.StatusUnprocessableEntity, "tls is locked by config")
		return
	}
	if locked["override_from"] && body.OverrideFrom != "" &&
		(cfg.Relay.OverrideFrom == nil || body.OverrideFrom != *cfg.Relay.OverrideFrom) {
		writeError(w, http.StatusUnprocessableEntity, "override_from is locked by config")
		return
	}
	if locked["return_path"] && body.ReturnPath != "" &&
		(cfg.Relay.ReturnPath == nil || body.ReturnPath != *cfg.Relay.ReturnPath) {
		writeError(w, http.StatusUnprocessableEntity, "return_path is locked by config")
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
	config.OverlayRelay(rc, cfg.Relay)
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
	if err := decodeJSON(w, r, &body); err != nil {
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
	configPath := config.SourcePathRef(cfg)
	if wc == nil {
		return webhookWire{Locked: locked, ConfigPath: configPath}
	}
	return webhookWire{
		Connected:  true,
		URL:        wc.URL,
		Enabled:    wc.Enabled,
		SecretHint: secretHint(locked["secret"], wc.Secret),
		Locked:     locked,
		ConfigPath: configPath,
	}
}

func storedConnectionWire[W any, S any](
	cfg *config.Loaded,
	locked map[string]bool,
	stored *S,
	init func(map[string]bool, *string) W,
	populate func(W, *S, map[string]bool) W,
) W {
	w := init(locked, config.SourcePathRef(cfg))
	if stored == nil {
		return w
	}
	return populate(w, stored, locked)
}

func connectionShow[T any](
	w http.ResponseWriter,
	r *http.Request,
	get func(context.Context) (*T, error),
	overlay func(*T),
	wire func(*T) any,
) {
	c, err := get(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, wire(nil))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	tmp := *c
	overlay(&tmp)
	writeJSON(w, http.StatusOK, wire(&tmp))
}

type storedConnectionKind int

const (
	storedConnectionCloud storedConnectionKind = iota
	storedConnectionRelay
	storedConnectionWebhook
)

func (s *Server) storedConnectionShow(w http.ResponseWriter, r *http.Request, kind storedConnectionKind) {
	cfg := s.connCfg()
	switch kind {
	case storedConnectionCloud:
		connectionShow(w, r, s.Store.CloudGet,
			func(c *store.CloudConnection) { config.OverlayCloud(c, cfg.Cloud) },
			func(c *store.CloudConnection) any { return s.cloudWire(c) },
		)
	case storedConnectionRelay:
		connectionShow(w, r, s.Store.RelayGet,
			func(rc *store.RelayConnection) { config.OverlayRelay(rc, cfg.Relay) },
			func(rc *store.RelayConnection) any { return s.relayWire(rc) },
		)
	case storedConnectionWebhook:
		connectionShow(w, r, s.Store.WebhookGet,
			func(wc *store.WebhookConnection) { config.OverlayWebhook(wc, cfg.Webhook) },
			func(wc *store.WebhookConnection) any { return s.webhookWire(wc) },
		)
	}
}

func (s *Server) storedConnectionShowHandler(kind storedConnectionKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.storedConnectionShow(w, r, kind)
	}
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
	if err := decodeJSON(w, r, &body); err != nil {
		return
	}
	if locked["url"] && body.URL != "" &&
		(cfg.Webhook.URL == nil || body.URL != *cfg.Webhook.URL) {
		writeError(w, http.StatusUnprocessableEntity, "url is locked by config")
		return
	}
	if locked["secret"] && body.Secret != nil &&
		(cfg.Webhook.Secret == nil || *body.Secret != *cfg.Webhook.Secret) {
		writeError(w, http.StatusUnprocessableEntity, "secret is locked by config")
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
	config.OverlayWebhook(wc, cfg.Webhook)
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
	if err := decodeJSON(w, r, &body); err != nil {
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
