package config

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte(body), 0o644))
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
	require.NotNil(t, got.Storage.MaxMessages)
	assert.Equal(t, 100, *got.Storage.MaxMessages)
}

func TestLoadCloudFields(t *testing.T) {
	got := loadFromFile(t, `
cloud:
  api_token: tok-abc
  sandbox_id: 7
  mirror_enabled: true
`)
	require.NotNil(t, got.Cloud.APIToken)
	assert.Equal(t, "tok-abc", *got.Cloud.APIToken)
	require.NotNil(t, got.Cloud.SandboxID)
	assert.Equal(t, int64(7), *got.Cloud.SandboxID)
	require.NotNil(t, got.Cloud.MirrorEnabled)
	assert.True(t, *got.Cloud.MirrorEnabled)
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
	require.NotNil(t, got.Relay.Host)
	assert.Equal(t, "smtp.example.com", *got.Relay.Host)
	require.NotNil(t, got.Relay.Port)
	assert.Equal(t, 587, *got.Relay.Port)
	require.NotNil(t, got.Relay.AutoRelayEnabled)
	assert.True(t, *got.Relay.AutoRelayEnabled)
}

func TestLoadWebhookFields(t *testing.T) {
	got := loadFromFile(t, `
webhook:
  url: https://hooks.example.com/x
  secret: shh
  enabled: true
`)
	require.NotNil(t, got.Webhook.URL)
	assert.Equal(t, "https://hooks.example.com/x", *got.Webhook.URL)
	require.NotNil(t, got.Webhook.Secret)
	assert.Equal(t, "shh", *got.Webhook.Secret)
	require.NotNil(t, got.Webhook.Enabled)
	assert.True(t, *got.Webhook.Enabled)
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
	require.NotNil(t, got.Cloud.APIToken)
	assert.Equal(t, "resolved-tok-XYZ", *got.Cloud.APIToken)
	require.NotNil(t, got.Relay.Password)
	assert.Equal(t, "resolved-passw0rd", *got.Relay.Password)
	require.NotNil(t, got.Relay.Username)
	assert.Equal(t, "literal-user", *got.Relay.Username)
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
	assert.Nil(t, got.Cloud.APIToken)
}

// TestNoFileFound — if neither MAILTRAP_LOCAL_CONFIG nor a file at the
// XDG path exists, Loader.Get() returns a zero-value Loaded with empty
// SourcePath. No error, no panic.
func TestNoFileFound(t *testing.T) {
	t.Setenv("MAILTRAP_LOCAL_CONFIG", filepath.Join(t.TempDir(), "does-not-exist.yml"))
	got := NewLoader().Get()
	assert.Empty(t, got.SourcePath)
	assert.Nil(t, got.Storage.MaxMessages)
}

// TestMalformedYAML — a syntax error doesn't crash the loader; it
// returns the same zero-value-Loaded shape as "no file found", but
// with SourcePath populated so a future ops endpoint could surface
// "your config didn't parse, here's the path".
func TestMalformedYAML(t *testing.T) {
	var logs bytes.Buffer
	restore := swapLogger(slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{
		Level: slog.LevelWarn,
	})))
	defer restore()

	got := loadFromFile(t, "this: is: not: valid yaml: [\n")
	assert.Nil(t, got.Storage.MaxMessages)
	assert.NotEmpty(t, got.SourcePath)
	assert.Contains(t, logs.String(), "config parse failed")
}

func swapLogger(l *slog.Logger) func() {
	prev := slog.Default()
	slog.SetDefault(l)
	return func() { slog.SetDefault(prev) }
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
	require.NotNil(t, got.Storage.MaxMessages)
	assert.Equal(t, 1, *got.Storage.MaxMessages)
	assert.Equal(t, override, got.SourcePath)
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
	require.NotNil(t, first.Storage.MaxMessages)
	require.Equal(t, 50, *first.Storage.MaxMessages)

	writeFile(t, path, `storage:
  max_messages: 200
`)
	second := l.Reload()
	require.NotNil(t, second.Storage.MaxMessages)
	assert.Equal(t, 200, *second.Storage.MaxMessages)

	// Subsequent Get returns the reloaded value.
	got := l.Get().Storage.MaxMessages
	require.NotNil(t, got)
	assert.Equal(t, 200, *got)
}
