package config

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func loadFromFile(t *testing.T, body string) *Loaded {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yml")
	writeFile(t, path, body)
	t.Setenv("MAILTRAP_LOCAL_CONFIG", path)
	return NewLoader().Get()
}

func TestLoadStorageMaxMessages(t *testing.T) {
	got := loadFromFile(t, `
storage:
  max_messages: 100
`)
	if got.Storage.MaxMessages == nil || *got.Storage.MaxMessages != 100 {
		t.Errorf("Storage.MaxMessages = %v, want 100", got.Storage.MaxMessages)
	}
}

func TestLoadCloudFields(t *testing.T) {
	got := loadFromFile(t, `
cloud:
  api_token: tok-abc
  sandbox_id: 7
  mirror_enabled: true
`)
	if got.Cloud.APIToken == nil || *got.Cloud.APIToken != "tok-abc" {
		t.Errorf("Cloud.APIToken = %v, want tok-abc", got.Cloud.APIToken)
	}
	if got.Cloud.SandboxID == nil || *got.Cloud.SandboxID != 7 {
		t.Errorf("Cloud.SandboxID = %v, want 7", got.Cloud.SandboxID)
	}
	if got.Cloud.MirrorEnabled == nil || !*got.Cloud.MirrorEnabled {
		t.Errorf("Cloud.MirrorEnabled = %v, want true", got.Cloud.MirrorEnabled)
	}
}

func TestLoadRelayFields(t *testing.T) {
	got := loadFromFile(t, `
relay:
  host: smtp.example.com
  port: 587
  username: u
  password: p
  auth: plain
  tls: auto
  auto_relay_enabled: true
  override_from: noreply@x.test
  return_path: bounces@x.test
`)
	if got.Relay.Host == nil || *got.Relay.Host != "smtp.example.com" {
		t.Errorf("Relay.Host = %v", got.Relay.Host)
	}
	if got.Relay.Port == nil || *got.Relay.Port != 587 {
		t.Errorf("Relay.Port = %v", got.Relay.Port)
	}
	if got.Relay.AutoRelayEnabled == nil || !*got.Relay.AutoRelayEnabled {
		t.Errorf("Relay.AutoRelayEnabled = %v, want true", got.Relay.AutoRelayEnabled)
	}
}

func TestLoadWebhookFields(t *testing.T) {
	got := loadFromFile(t, `
webhook:
  url: https://hooks.example.com/x
  secret: shh
  enabled: true
`)
	if got.Webhook.URL == nil || *got.Webhook.URL != "https://hooks.example.com/x" {
		t.Errorf("Webhook.URL = %v", got.Webhook.URL)
	}
	if got.Webhook.Secret == nil || *got.Webhook.Secret != "shh" {
		t.Errorf("Webhook.Secret = %v", got.Webhook.Secret)
	}
	if got.Webhook.Enabled == nil || !*got.Webhook.Enabled {
		t.Errorf("Webhook.Enabled = %v", got.Webhook.Enabled)
	}
}

// TestEnvInterpolation — `${VAR}` references in string fields resolve
// to the env var. Used heavily in CI/secret-management workflows where
// the YAML is committed but the credentials live in env.
func TestEnvInterpolation(t *testing.T) {
	t.Setenv("MTL_TEST_TOKEN", "resolved-tok-XYZ")
	t.Setenv("MTL_TEST_PASS", "resolved-passw0rd")

	got := loadFromFile(t, `
cloud:
  api_token: ${MTL_TEST_TOKEN}
relay:
  password: ${MTL_TEST_PASS}
  username: literal-user
`)
	if got.Cloud.APIToken == nil || *got.Cloud.APIToken != "resolved-tok-XYZ" {
		t.Errorf("Cloud.APIToken = %v, want resolved-tok-XYZ", got.Cloud.APIToken)
	}
	if got.Relay.Password == nil || *got.Relay.Password != "resolved-passw0rd" {
		t.Errorf("Relay.Password = %v, want resolved-passw0rd", got.Relay.Password)
	}
	if got.Relay.Username == nil || *got.Relay.Username != "literal-user" {
		t.Errorf("Relay.Username = %v, want literal-user", got.Relay.Username)
	}
}

// Unset env vars resolve to nil — same shape as "key not in YAML".
// That way callers don't get accidental empty-string credentials.
func TestEnvInterpolationUnsetResolvesToNil(t *testing.T) {
	t.Setenv("MTL_DEFINITELY_UNSET", "")
	_ = os.Unsetenv("MTL_DEFINITELY_UNSET")

	got := loadFromFile(t, `
cloud:
  api_token: ${MTL_DEFINITELY_UNSET}
`)
	if got.Cloud.APIToken != nil {
		t.Errorf("Cloud.APIToken = %v, want nil for unset env var", got.Cloud.APIToken)
	}
}

// TestNoFileFound — if neither MAILTRAP_LOCAL_CONFIG nor a file at the
// XDG path exists, Loader.Get() returns a zero-value Loaded with empty
// SourcePath. No error, no panic.
func TestNoFileFound(t *testing.T) {
	t.Setenv("MAILTRAP_LOCAL_CONFIG", filepath.Join(t.TempDir(), "does-not-exist.yml"))
	got := NewLoader().Get()
	if got.SourcePath != "" {
		t.Errorf("SourcePath = %q, want \"\" when file missing", got.SourcePath)
	}
	if got.Storage.MaxMessages != nil {
		t.Errorf("Storage.MaxMessages = %v, want nil with no config", got.Storage.MaxMessages)
	}
}

// TestMalformedYAML — a syntax error doesn't crash the loader; it
// returns the same zero-value-Loaded shape as "no file found", but
// with SourcePath populated so a future ops endpoint could surface
// "your config didn't parse, here's the path".
func TestMalformedYAML(t *testing.T) {
	got := loadFromFile(t, "this: is: not: valid yaml: [\n")
	if got.Storage.MaxMessages != nil {
		t.Errorf("malformed YAML should yield zero-value Storage; got %+v", got.Storage)
	}
	if got.SourcePath == "" {
		t.Errorf("SourcePath should be populated even when parse fails")
	}
}

// TestExplicitConfigPathBeatsXDG — MAILTRAP_LOCAL_CONFIG always wins
// over the XDG-derived default, so a user can pin a custom path
// without polluting their global config dir.
func TestExplicitConfigPathBeatsXDG(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)
	xdgPath := filepath.Join(xdg, "mailtrap-local", "config.yml")
	writeFile(t, xdgPath, `storage:
  max_messages: 999
`)

	override := filepath.Join(t.TempDir(), "alt.yml")
	writeFile(t, override, `storage:
  max_messages: 1
`)
	t.Setenv("MAILTRAP_LOCAL_CONFIG", override)

	got := NewLoader().Get()
	if got.Storage.MaxMessages == nil || *got.Storage.MaxMessages != 1 {
		t.Errorf("MAILTRAP_LOCAL_CONFIG should win; got MaxMessages=%v", got.Storage.MaxMessages)
	}
	if got.SourcePath != override {
		t.Errorf("SourcePath = %q, want %q", got.SourcePath, override)
	}
}

// TestReloadRefreshesCache — Reload() picks up file edits, even if Get
// has already cached the previous version.
func TestReloadRefreshesCache(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yml")
	t.Setenv("MAILTRAP_LOCAL_CONFIG", path)

	writeFile(t, path, `storage:
  max_messages: 50
`)
	l := NewLoader()
	first := l.Get()
	if first.Storage.MaxMessages == nil || *first.Storage.MaxMessages != 50 {
		t.Fatalf("first read: MaxMessages = %v, want 50", first.Storage.MaxMessages)
	}

	writeFile(t, path, `storage:
  max_messages: 200
`)
	second := l.Reload()
	if second.Storage.MaxMessages == nil || *second.Storage.MaxMessages != 200 {
		t.Errorf("after Reload: MaxMessages = %v, want 200", second.Storage.MaxMessages)
	}

	// Subsequent Get returns the reloaded value.
	if got := l.Get().Storage.MaxMessages; got == nil || *got != 200 {
		t.Errorf("Get after Reload: MaxMessages = %v, want 200", got)
	}
}
