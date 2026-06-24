package jobs

import (
	"testing"

	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOverlayRelay(t *testing.T) {
	t.Parallel()
	db := &store.RelayConnection{
		Host: "db-host", Port: 25, Username: "db-user", Password: "db-pass",
		Auth: "plain", TLS: "auto", AutoRelayEnabled: false,
		OverrideFrom: "db-from@test", ReturnPath: "db-return@test",
	}
	host, port, user, pass := "cfg-host", 587, "cfg-user", "cfg-pass"
	auth, tls := "login", "starttls"
	autoRelay, overrideFrom, returnPath := true, "cfg-from@test", "cfg-return@test"

	got := overlayRelay(db, config.Relay{
		Host:             &host,
		Port:             &port,
		Username:         &user,
		Password:         &pass,
		Auth:             &auth,
		TLS:              &tls,
		AutoRelayEnabled: &autoRelay,
		OverrideFrom:     &overrideFrom,
		ReturnPath:       &returnPath,
	})

	assert.Equal(t, "cfg-host", got.Host)
	assert.Equal(t, 587, got.Port)
	assert.Equal(t, "cfg-user", got.Username)
	assert.Equal(t, "cfg-pass", got.Password)
	assert.Equal(t, "login", got.Auth)
	assert.Equal(t, "starttls", got.TLS)
	assert.True(t, got.AutoRelayEnabled)
	assert.Equal(t, "cfg-from@test", got.OverrideFrom)
	assert.Equal(t, "cfg-return@test", got.ReturnPath)
}

func TestOverlayWebhook(t *testing.T) {
	t.Parallel()
	db := &store.WebhookConnection{URL: "https://db", Secret: "db-sec", Enabled: false}
	url, secret, enabled := "https://cfg", "cfg-sec", true

	gotURL, gotSecret, gotEnabled := overlayWebhook(db, config.Webhook{
		URL: &url, Secret: &secret, Enabled: &enabled,
	})
	assert.Equal(t, "https://cfg", gotURL)
	assert.Equal(t, "cfg-sec", gotSecret)
	assert.True(t, gotEnabled)

	// Nil DB falls back to config-only values.
	gotURL, gotSecret, gotEnabled = overlayWebhook(nil, config.Webhook{URL: &url})
	assert.Equal(t, "https://cfg", gotURL)
	assert.Empty(t, gotSecret)
	assert.False(t, gotEnabled)
}

func TestMarshalSummary(t *testing.T) {
	t.Parallel()
	b, err := MarshalSummary(map[string]string{"id": "abc"})
	require.NoError(t, err)
	assert.JSONEq(t, `{"id":"abc"}`, string(b))
}
