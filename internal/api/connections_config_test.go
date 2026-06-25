package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/live"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testServerWithConfig(t *testing.T, yamlBody string) *httptest.Server {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yml")
	require.NoError(t, os.WriteFile(path, []byte(yamlBody), 0o644))
	t.Setenv("MAILTRAP_LOCAL_CONFIG", path)

	st, err := store.OpenMemory()
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })

	srv := &Server{
		Store:   st,
		Hub:     live.NewHub(),
		Relay:   &relay.Client{},
		Webhook: webhook.NewClient(),
		Config:  config.NewLoader(),
	}
	return httptest.NewServer(srv.Router())
}

func TestCloudConnectionPinnedByConfig(t *testing.T) {
	httpSrv := testServerWithConfig(t, `
cloud:
  api_token: pinned-tok
  sandbox_id: 42
`)
	defer httpSrv.Close()

	var show cloudWire
	require.Equal(t, http.StatusOK, getJSON(t, httpSrv.URL+"/api/v1/cloud_connection", &show))
	assert.True(t, show.Locked["api_token"])
	assert.True(t, show.Locked["sandbox_id"])
	assert.NotNil(t, show.ConfigPath)

	req, err := http.NewRequest(http.MethodPut, httpSrv.URL+"/api/v1/cloud_connection",
		bytes.NewReader(mustJSON(t, map[string]any{
			"api_token":  "other",
			"sandbox_id": 1,
		})))
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
}

func TestCloudConnectionUnlockedUpdate(t *testing.T) {
	httpSrv := testServerWithConfig(t, "")
	defer httpSrv.Close()

	req, err := http.NewRequest(http.MethodPut, httpSrv.URL+"/api/v1/cloud_connection",
		bytes.NewReader(mustJSON(t, map[string]any{
			"api_token":      "tok",
			"sandbox_id":     7,
			"mirror_enabled": true,
		})))
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var out cloudWire
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	assert.True(t, out.Connected)
	assert.Equal(t, int64(7), out.SandboxID)
	assert.True(t, out.MirrorEnabled)
	require.NotNil(t, out.APITokenHint)
	assert.Equal(t, "••••tok", *out.APITokenHint)
}

func TestCloudConnectionPinnedFieldRejected(t *testing.T) {
	httpSrv := testServerWithConfig(t, `
cloud:
  sandbox_id: 99
`)
	defer httpSrv.Close()

	// seed DB: sandbox_id comes from config (99)
	req, err := http.NewRequest(http.MethodPut, httpSrv.URL+"/api/v1/cloud_connection",
		bytes.NewReader(mustJSON(t, map[string]any{
			"api_token": "tok",
		})))
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)

	// attempt to change pinned sandbox_id
	req, err = http.NewRequest(http.MethodPut, httpSrv.URL+"/api/v1/cloud_connection",
		bytes.NewReader(mustJSON(t, map[string]any{
			"api_token":  "tok",
			"sandbox_id": 2,
		})))
	require.NoError(t, err)
	resp, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
}

func TestCloudConnectionPinnedMirrorRejected(t *testing.T) {
	httpSrv := testServerWithConfig(t, `
cloud:
  mirror_enabled: true
`)
	defer httpSrv.Close()

	req, err := http.NewRequest(http.MethodPut, httpSrv.URL+"/api/v1/cloud_connection",
		bytes.NewReader(mustJSON(t, map[string]any{
			"api_token":      "tok",
			"sandbox_id":     1,
			"mirror_enabled": false,
		})))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
}
