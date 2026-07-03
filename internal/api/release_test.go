package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func postJSON(t *testing.T, url string, body any) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(mustJSON(t, body))))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return resp.StatusCode, b
}

func putRelay(t *testing.T, base string) {
	t.Helper()
	body := mustJSON(t, map[string]any{
		"host": "127.0.0.1", "port": 1, "username": "u", "password": "p",
	})
	req, err := http.NewRequest(http.MethodPut, base+"/api/v1/relay_connection", strings.NewReader(string(body)))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
}

func putCloud(t *testing.T, base string) {
	t.Helper()
	body := mustJSON(t, map[string]any{
		"api_token": "bad-token", "sandbox_id": 1,
	})
	req, err := http.NewRequest(http.MethodPut, base+"/api/v1/cloud_connection", strings.NewReader(string(body)))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestReleaseValidation(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	id := ingestSample(t, ts.URL, "Release", "a@x.test", "b@y.test", "test")

	code, _ := postJSON(t, ts.URL+"/api/v1/message/"+id+"/release", map[string]any{"to": []string{}})
	assert.Equal(t, http.StatusUnprocessableEntity, code)
}

func TestReleaseNotFound(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	code, _ := postJSON(t, ts.URL+"/api/v1/message/nope/release", map[string]any{"to": []string{"x@test"}})
	assert.Equal(t, http.StatusNotFound, code)
}

func TestReleaseNoRelay(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	id := ingestSample(t, ts.URL, "NoRelay", "a@x.test", "b@y.test", "test")

	code, _ := postJSON(t, ts.URL+"/api/v1/message/"+id+"/release", map[string]any{"to": []string{"x@test"}})
	assert.Equal(t, http.StatusServiceUnavailable, code)
}

func TestReleaseRelayFailure(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	putRelay(t, ts.URL)
	id := ingestSample(t, ts.URL, "RelayFail", "a@x.test", "b@y.test", "test")

	code, body := postJSON(t, ts.URL+"/api/v1/message/"+id+"/release", map[string]any{"to": []string{"x@test"}})
	assert.Equal(t, http.StatusBadGateway, code)
	assert.Contains(t, string(body), "SMTP relay failed")
}

func TestSendToCloudNotFound(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	code, _ := postJSON(t, ts.URL+"/api/v1/message/nope/send_to_cloud", nil)
	assert.Equal(t, http.StatusNotFound, code)
}

func TestSendToCloudNoConnection(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	id := ingestSample(t, ts.URL, "NoCloud", "a@x.test", "b@y.test", "test")

	code, _ := postJSON(t, ts.URL+"/api/v1/message/"+id+"/send_to_cloud", nil)
	assert.Equal(t, http.StatusServiceUnavailable, code)
}

func TestSendToCloudUpstreamFailure(t *testing.T) {
	t.Parallel()
	srv, ts := newTestServer(t)
	cloudStub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(cloudStub.Close)
	srv.CloudBaseURL = cloudStub.URL

	putCloud(t, ts.URL)
	id := ingestSample(t, ts.URL, "CloudFail", "a@x.test", "b@y.test", "test")

	code, _ := postJSON(t, ts.URL+"/api/v1/message/"+id+"/send_to_cloud", nil)
	assert.Equal(t, http.StatusBadGateway, code)
}

func TestHTMLCheckNotFound(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	code := getJSON(t, ts.URL+"/api/v1/message/nope/html_check", nil)
	assert.Equal(t, http.StatusNotFound, code)
}

func ingestPlain(t *testing.T, base, subject string) string {
	t.Helper()
	payload := mustJSON(t, store.IngestPayload{
		SMTPFrom:  "a@x.test",
		SMTPTo:    []string{"b@y.test"},
		MessageID: "<msg-" + subject + "@test>",
		From:      &store.Address{Name: "Sender", Address: "a@x.test"},
		To:        []store.Address{{Address: "b@y.test"}},
		Subject:   subject,
		Text:      "plain body",
		Raw:       []byte("From: a@x.test\r\nSubject: " + subject + "\r\n\r\nplain\r\n"),
		Snippet:   "plain body",
	})
	resp, err := http.Post(base+"/api/v1/ingest", "application/json", bytes.NewReader(payload))
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var out struct{ ID string }
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out.ID
}

func TestHTMLCheckNoHTML(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	id := ingestPlain(t, ts.URL, "Plain")

	var out map[string]any
	code := getJSON(t, ts.URL+"/api/v1/message/"+id+"/html_check", &out)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "no_html", out["status"])
}

func TestHTMLCheckWithHTML(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	id := ingestSample(t, ts.URL, "HTML", "a@x.test", "b@y.test", "test")

	var out map[string]any
	code := getJSON(t, ts.URL+"/api/v1/message/"+id+"/html_check", &out)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "success", out["status"])
	_, hasIssues := out["issues"]
	assert.True(t, hasIssues)
}

func TestHTMLCheckSizeLimit(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	huge := strings.Repeat("x", 1<<20+1)
	payload := mustJSON(t, store.IngestPayload{
		SMTPFrom:  "a@x.test",
		SMTPTo:    []string{"b@y.test"},
		MessageID: "<msg-huge@test>",
		From:      &store.Address{Address: "a@x.test"},
		To:        []store.Address{{Address: "b@y.test"}},
		Subject:   "Huge",
		HTML:      huge,
		Raw:       []byte("raw"),
		Snippet:   "huge",
	})
	resp, err := http.Post(ts.URL+"/api/v1/ingest", "application/json", bytes.NewReader(payload))
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	var created struct{ ID string }
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&created))

	var out map[string]any
	code := getJSON(t, ts.URL+"/api/v1/message/"+created.ID+"/html_check", &out)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "size_limit_exceeded", out["status"])
}
