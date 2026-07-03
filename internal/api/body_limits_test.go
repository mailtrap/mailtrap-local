package api

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIngestRejectsOversizedBody(t *testing.T) {
	_, httpSrv := newTestServer(t)
	defer httpSrv.Close()

	// Valid JSON shape, payload exceeds maxRequestBodyBytes.
	payload := `{"smtp_from":"a@test","raw":"` +
		strings.Repeat("x", maxRequestBodyBytes) + `"}`
	req, err := http.NewRequest(http.MethodPost, httpSrv.URL+"/api/v1/ingest",
		bytes.NewReader([]byte(payload)))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.StatusCode)
}

func TestCloudUpdateAcceptsSmallBody(t *testing.T) {
	_, httpSrv := newTestServer(t)
	defer httpSrv.Close()

	req, err := http.NewRequest(http.MethodPut, httpSrv.URL+"/api/v1/cloud_connection",
		bytes.NewReader([]byte(`{"api_token":"tok","sandbox_id":1}`)))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}
