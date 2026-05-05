// Package config loads optional user configuration from YAML at
// `$XDG_CONFIG_HOME/mailtrap-local/config.yml` (override path with
// MAILTRAP_LOCAL_CONFIG). Sections are pinned: any key present here
// overrides the equivalent DB row, and the dialog renders the field
// read-only.
//
// Sections:
//
//	storage:
//	  max_messages: 500     # 0 = unlimited; default 500
//	cloud:
//	  api_token: ${MAILTRAP_API_TOKEN}
//	  sandbox_id: 12345
//	  mirror_enabled: true
//	relay:
//	  host: smtp.example.com
//	  port: 587
//	  username: user
//	  password: ${SMTP_PASSWORD}
//	  auth: plain
//	  tls: auto
//	  auto_relay_enabled: false
//	  override_from: noreply@example.com
//	  return_path: bounces@example.com
//	webhook:
//	  url: https://hooks.example.com/inbox
//	  secret: ${WEBHOOK_SECRET}
//	  enabled: true
//
// `${VAR}` references resolve to the named environment variable. Unset
// vars resolve to nil (treated the same as omitting the key).
package config

import (
	"os"
	"path/filepath"
	"regexp"
	"sync"

	"gopkg.in/yaml.v3"
)

var envRefRe = regexp.MustCompile(`\A\$\{([A-Z_][A-Z0-9_]*)\}\z`)

// Storage is the pinnable subset of the storage section.
type Storage struct {
	MaxMessages *int `yaml:"max_messages"`
}

// Cloud is the pinnable subset of the cloud section.
type Cloud struct {
	APIToken      *string `yaml:"api_token"`
	SandboxID     *int64  `yaml:"sandbox_id"`
	MirrorEnabled *bool   `yaml:"mirror_enabled"`
}

// Relay is the pinnable subset of the relay section.
type Relay struct {
	Host             *string `yaml:"host"`
	Port             *int    `yaml:"port"`
	Username         *string `yaml:"username"`
	Password         *string `yaml:"password"`
	Auth             *string `yaml:"auth"`
	TLS              *string `yaml:"tls"`
	AutoRelayEnabled *bool   `yaml:"auto_relay_enabled"`
	OverrideFrom     *string `yaml:"override_from"`
	ReturnPath       *string `yaml:"return_path"`
}

// Webhook is the pinnable subset of the webhook section.
type Webhook struct {
	URL     *string `yaml:"url"`
	Secret  *string `yaml:"secret"`
	Enabled *bool   `yaml:"enabled"`
}

// Loaded is the parsed config + the resolved file path (nil if no file
// was found at the resolved location).
type Loaded struct {
	Storage    Storage
	Cloud      Cloud
	Relay      Relay
	Webhook    Webhook
	SourcePath string // empty if no file was found
}

// Loader is the cached config holder. Use Get/Reload from handlers.
type Loader struct {
	mu     sync.RWMutex
	loaded *Loaded
}

// NewLoader creates an empty loader; call Reload to read from disk.
func NewLoader() *Loader { return &Loader{} }

// Get returns the cached Loaded, reading from disk on first call.
func (l *Loader) Get() *Loaded {
	l.mu.RLock()
	if l.loaded != nil {
		defer l.mu.RUnlock()
		return l.loaded
	}
	l.mu.RUnlock()
	return l.Reload()
}

// Reload re-reads the config file from disk and replaces the cache.
// Always succeeds — IO errors are logged via the returned Loaded's
// SourcePath being empty (the same shape as "no file found").
func (l *Loader) Reload() *Loaded {
	out := &Loaded{}

	path := resolvePath()
	if path != "" {
		if data, err := os.ReadFile(path); err == nil {
			out.SourcePath = path
			parse(data, out)
		}
	}

	l.mu.Lock()
	l.loaded = out
	l.mu.Unlock()
	return out
}

// resolvePath returns the YAML config path: MAILTRAP_LOCAL_CONFIG if
// set, else $XDG_CONFIG_HOME/mailtrap-local/config.yml (with HOME
// fallback). Returns "" if no path can be resolved.
func resolvePath() string {
	if v := os.Getenv("MAILTRAP_LOCAL_CONFIG"); v != "" {
		return v
	}
	xdg := os.Getenv("XDG_CONFIG_HOME")
	if xdg == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		xdg = filepath.Join(home, ".config")
	}
	return filepath.Join(xdg, "mailtrap-local", "config.yml")
}

// parse fills `out` from raw YAML bytes. ${ENV} interpolation is
// applied during decode.
func parse(data []byte, out *Loaded) {
	var raw struct {
		Storage Storage `yaml:"storage"`
		Cloud   Cloud   `yaml:"cloud"`
		Relay   Relay   `yaml:"relay"`
		Webhook Webhook `yaml:"webhook"`
	}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return
	}
	out.Storage = raw.Storage
	out.Cloud = interpolateCloud(raw.Cloud)
	out.Relay = interpolateRelay(raw.Relay)
	out.Webhook = interpolateWebhook(raw.Webhook)
}

func interpolateString(p *string) *string {
	if p == nil {
		return nil
	}
	if v := envExpand(*p); v == "" {
		return nil
	} else {
		return &v
	}
}

func envExpand(s string) string {
	m := envRefRe.FindStringSubmatch(s)
	if m == nil {
		return s
	}
	return os.Getenv(m[1])
}

func interpolateCloud(c Cloud) Cloud {
	c.APIToken = interpolateString(c.APIToken)
	return c
}

func interpolateRelay(r Relay) Relay {
	r.Host = interpolateString(r.Host)
	r.Username = interpolateString(r.Username)
	r.Password = interpolateString(r.Password)
	r.OverrideFrom = interpolateString(r.OverrideFrom)
	r.ReturnPath = interpolateString(r.ReturnPath)
	r.Auth = interpolateString(r.Auth)
	r.TLS = interpolateString(r.TLS)
	return r
}

func interpolateWebhook(w Webhook) Webhook {
	w.URL = interpolateString(w.URL)
	w.Secret = interpolateString(w.Secret)
	return w
}
