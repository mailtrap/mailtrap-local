package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRelayTestMissingHost(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	code, body := postJSON(t, ts.URL+"/api/v1/relay_connection/test", map[string]any{})
	require.Equal(t, http.StatusOK, code)

	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	assert.Equal(t, false, out["ok"])
	assert.Equal(t, "host required", out["error"])
}

func TestRelayTestUnreachable(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	code, body := postJSON(t, ts.URL+"/api/v1/relay_connection/test", map[string]any{
		"host": "127.0.0.1", "port": 1,
	})
	require.Equal(t, http.StatusOK, code)

	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	assert.Equal(t, false, out["ok"])
	_, hasErr := out["error"]
	assert.True(t, hasErr)
}

func TestRelayTestUsesSavedPassword(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	putRelay(t, ts.URL)

	code, body := postJSON(t, ts.URL+"/api/v1/relay_connection/test", map[string]any{
		"host": "127.0.0.1", "port": 1, "username": "u",
	})
	require.Equal(t, http.StatusOK, code)

	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	assert.Equal(t, false, out["ok"])
}

func TestWebhookTestMissingURL(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	code, body := postJSON(t, ts.URL+"/api/v1/webhook_connection/test", map[string]any{})
	require.Equal(t, http.StatusOK, code)

	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	assert.Equal(t, false, out["ok"])
	assert.Equal(t, "URL is required", out["error"])
}

func TestWebhookTestUnreachable(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	code, body := postJSON(t, ts.URL+"/api/v1/webhook_connection/test", map[string]any{
		"url": "http://127.0.0.1:1/nope", "secret": "s",
	})
	require.Equal(t, http.StatusOK, code)

	var out map[string]any
	require.NoError(t, json.Unmarshal(body, &out))
	assert.Equal(t, false, out["ok"])
}
