package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mailtrap/mailtrap-local/internal/live"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// helper: build a Server backed by an in-memory store + httptest server.
func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	st, err := store.OpenMemory()
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })

	srv := &Server{
		Store:   st,
		Hub:     live.NewHub(),
		Relay:   &relay.Client{},
		Webhook: webhook.NewClient(),
	}
	httpSrv := httptest.NewServer(srv.Router())
	t.Cleanup(httpSrv.Close)
	return srv, httpSrv
}

// ingestSample posts a message via /api/v1/ingest and returns its ID.
func ingestSample(t *testing.T, base string, subject, fromAddr, toAddr, category string) string {
	t.Helper()
	payload := mustJSON(t, store.IngestPayload{
		SMTPFrom:  fromAddr,
		SMTPTo:    []string{toAddr},
		MessageID: "<msg-" + subject + "@test>",
		From:      &store.Address{Name: "Sender", Address: fromAddr},
		To:        []store.Address{{Address: toAddr}},
		Subject:   subject,
		Category:  category,
		Text:      "Body of " + subject,
		HTML:      "<p>" + subject + "</p>",
		Raw:       []byte("From: " + fromAddr + "\r\nSubject: " + subject + "\r\n\r\nbody\r\n"),
		Snippet:   "Body of " + subject,
	})
	resp, err := http.Post(base+"/api/v1/ingest", "application/json", bytes.NewReader(payload))
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		require.FailNow(t, "ingest status", "%d: %s", resp.StatusCode, body)
	}
	var out struct{ ID string }
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&out))
	return out.ID
}

// getJSON unmarshals a GET into v.
func getJSON(t *testing.T, url string, v any) int {
	t.Helper()
	resp, err := http.Get(url)
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	if v != nil {
		_ = json.NewDecoder(resp.Body).Decode(v)
	}
	return resp.StatusCode
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return b
}

func TestListEndpointEnvelope(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	ingestSample(t, ts.URL, "Welcome", "a@x.test", "b@y.test", "welcome")

	var resp MessagesResponse
	assert.Equal(t, 200, getJSON(t, ts.URL+"/api/v1/messages", &resp))
	assert.Equal(t, 1, resp.Total)
	assert.Equal(t, 1, resp.Count)
	assert.Equal(t, 1, resp.Unread)
	require.Len(t, resp.Messages, 1)

	got := resp.Messages[0]
	assert.Equal(t, "Welcome", got.Subject)
	assert.Equal(t, []string{"welcome"}, got.Tags)
	assert.Equal(t, "a@x.test", got.From.Address)
	assert.False(t, got.Read)
}

func TestGetMessageMarksAsRead(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	id := ingestSample(t, ts.URL, "x", "a@x", "b@y", "")

	var detail MessageDetail
	getJSON(t, ts.URL+"/api/v1/message/"+id, &detail)

	var listResp MessagesResponse
	getJSON(t, ts.URL+"/api/v1/messages", &listResp)
	assert.Equal(t, 0, listResp.Unread)
}

func TestRawHeadersEndpoints(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	id := ingestSample(t, ts.URL, "Subject Test", "a@x", "b@y", "")

	resp, err := http.Get(ts.URL + "/api/v1/message/" + id + "/raw")
	require.NoError(t, err)
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	assert.Contains(t, string(body), "Subject: Subject Test")
	assert.Contains(t, resp.Header.Get("Content-Disposition"), "inline")

	var hdrs map[string][]string
	getJSON(t, ts.URL+"/api/v1/message/"+id+"/headers", &hdrs)
	require.NotEmpty(t, hdrs["Subject"])
	assert.Equal(t, "Subject Test", hdrs["Subject"][0])
}

func TestSearchEndpoint(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	ingestSample(t, ts.URL, "Welcome aboard", "a@x", "alice@y", "welcome")
	ingestSample(t, ts.URL, "Reset password", "auth@x", "alice@y", "transactional")

	var resp MessagesResponse
	getJSON(t, ts.URL+"/api/v1/search?query=welcome", &resp)
	assert.Equal(t, 1, resp.Total)
	assert.Equal(t, "Welcome aboard", resp.Messages[0].Subject)

	getJSON(t, ts.URL+"/api/v1/search?query=", &resp)
	assert.Equal(t, 0, resp.Total)
	assert.Empty(t, resp.Messages)
	assert.Equal(t, []string{"transactional", "welcome"}, resp.Tags)
}

func TestDeleteAndReadToggle(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	id1 := ingestSample(t, ts.URL, "a", "a@x", "b@y", "")
	id2 := ingestSample(t, ts.URL, "b", "a@x", "b@y", "")
	_ = ingestSample(t, ts.URL, "c", "a@x", "b@y", "")

	body := mustJSON(t, map[string]any{"read": true})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()

	var listResp MessagesResponse
	getJSON(t, ts.URL+"/api/v1/messages", &listResp)
	assert.Equal(t, 0, listResp.Unread)

	delBody := mustJSON(t, map[string]any{"ids": []string{id1, id2}})
	req, _ = http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/messages", bytes.NewReader(delBody))
	req.Header.Set("Content-Type", "application/json")
	resp, _ = http.DefaultClient.Do(req)
	_ = resp.Body.Close()

	getJSON(t, ts.URL+"/api/v1/messages", &listResp)
	assert.Equal(t, 1, listResp.Total)

	allBody := mustJSON(t, map[string]any{"all": true})
	req, _ = http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/messages", bytes.NewReader(allBody))
	req.Header.Set("Content-Type", "application/json")
	resp, _ = http.DefaultClient.Do(req)
	_ = resp.Body.Close()
	getJSON(t, ts.URL+"/api/v1/messages", &listResp)
	assert.Equal(t, 0, listResp.Total)
}

func TestDeleteMessagesRequiresExplicitSignal(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	ingestSample(t, ts.URL, "x", "a@x", "b@y", "")
	ingestSample(t, ts.URL, "y", "a@x", "b@y", "")

	cases := []struct {
		name    string
		body    []byte
		setCT   bool
		wantSC  int
		wantMsg string
	}{
		{
			name:    "no body (Content-Length = 0)",
			body:    nil,
			setCT:   false,
			wantSC:  http.StatusUnprocessableEntity,
			wantMsg: "requires a JSON body",
		},
		{
			name:    "empty JSON object",
			body:    []byte(`{}`),
			setCT:   true,
			wantSC:  http.StatusUnprocessableEntity,
			wantMsg: `all\":true`,
		},
		{
			name:    "ids: []",
			body:    []byte(`{"ids":[]}`),
			setCT:   true,
			wantSC:  http.StatusUnprocessableEntity,
			wantMsg: `all\":true`,
		},
		{
			name:    "malformed JSON",
			body:    []byte(`{"ids": ["abc",`),
			setCT:   true,
			wantSC:  http.StatusBadRequest,
			wantMsg: "decode:",
		},
		{
			name:    "all: false (typo where user meant true)",
			body:    []byte(`{"all":false}`),
			setCT:   true,
			wantSC:  http.StatusUnprocessableEntity,
			wantMsg: `all\":true`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			var req *http.Request
			if c.body == nil {
				req, _ = http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/messages", nil)
			} else {
				req, _ = http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/messages", bytes.NewReader(c.body))
			}
			if c.setCT {
				req.Header.Set("Content-Type", "application/json")
			}
			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			defer func() { _ = resp.Body.Close() }()
			assert.Equal(t, c.wantSC, resp.StatusCode)
			raw, _ := io.ReadAll(resp.Body)
			assert.Contains(t, string(raw), c.wantMsg)

			var listResp MessagesResponse
			getJSON(t, ts.URL+"/api/v1/messages", &listResp)
			assert.Equal(t, 2, listResp.Total)
		})
	}
}

func TestDocsRedirect(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	c := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := c.Get(ts.URL + "/api/v1")
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusFound, resp.StatusCode)
	assert.Equal(t, "https://docs.mailtrap.io/", resp.Header.Get("Location"))
}

func TestVersion(t *testing.T) {
	t.Parallel()
	srv, ts := newTestServer(t)
	srv.Build = BuildInfo{
		Version:   "0.1.0-test",
		Commit:    "deadbeef",
		BuildDate: "2026-07-03T10:00:00Z",
	}

	var resp VersionResponse
	assert.Equal(t, 200, getJSON(t, ts.URL+"/api/v1/version", &resp))
	assert.Equal(t, "0.1.0-test", resp.Version)
	assert.Equal(t, "deadbeef", resp.Commit)
	assert.Equal(t, "2026-07-03T10:00:00Z", resp.BuildDate)
}

func TestOpenAPIYAML(t *testing.T) {
	t.Parallel()
	srv, ts := newTestServer(t)
	srv.OpenAPI = []byte("openapi: 3.1.0\ninfo:\n  title: test\n")

	resp, err := http.Get(ts.URL + "/api/v1/openapi.yaml")
	require.NoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Contains(t, resp.Header.Get("Content-Type"), "yaml")
	body, _ := io.ReadAll(resp.Body)
	assert.True(t, strings.HasPrefix(string(body), "openapi: 3.1.0"))
}

func TestConnectionsCRUD(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	body := mustJSON(t, map[string]any{
		"api_token": "tok", "sandbox_id": 9001, "mirror_enabled": true,
	})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/cloud_connection", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := http.DefaultClient.Do(req)
	_ = resp.Body.Close()

	var cloud map[string]any
	getJSON(t, ts.URL+"/api/v1/cloud_connection", &cloud)
	assert.Equal(t, true, cloud["connected"])

	body = mustJSON(t, map[string]any{
		"url": "https://hooks.example.com/x", "secret": "shh", "enabled": true,
	})
	req, _ = http.NewRequest(http.MethodPut, ts.URL+"/api/v1/webhook_connection", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, _ = http.DefaultClient.Do(req)
	_ = resp.Body.Close()

	var wh map[string]any
	getJSON(t, ts.URL+"/api/v1/webhook_connection", &wh)
	assert.Equal(t, true, wh["connected"])
	assert.Equal(t, true, wh["enabled"])
	_, has := wh["secret"]
	assert.False(t, has)
}

func TestRelayConnectionCRUD(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	put := func(payload map[string]any) *http.Response {
		body := mustJSON(t, payload)
		req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/relay_connection", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, _ := http.DefaultClient.Do(req)
		return resp
	}

	resp := put(map[string]any{
		"host": "smtp.example.com", "port": 587, "username": "u", "password": "p",
		"auto_relay_enabled": true,
	})
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var relay map[string]any
	getJSON(t, ts.URL+"/api/v1/relay_connection", &relay)
	assert.Equal(t, true, relay["connected"])
	assert.Equal(t, "smtp.example.com", relay["host"])
	assert.InEpsilon(t, float64(587), relay["port"], 0)

	// Partial update preserves password when omitted.
	resp = put(map[string]any{"host": "smtp.example.com", "auto_relay_enabled": false})
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/relay_connection", nil)
	resp, _ = http.DefaultClient.Do(req)
	_ = resp.Body.Close()
	getJSON(t, ts.URL+"/api/v1/relay_connection", &relay)
	assert.Equal(t, false, relay["connected"])
}

func TestWebhookConnectionDestroy(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	body := mustJSON(t, map[string]any{
		"url": "https://hooks.example.com/x", "enabled": true,
	})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/webhook_connection", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := http.DefaultClient.Do(req)
	_ = resp.Body.Close()

	req, _ = http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/webhook_connection", nil)
	resp, _ = http.DefaultClient.Do(req)
	_ = resp.Body.Close()

	var wh map[string]any
	getJSON(t, ts.URL+"/api/v1/webhook_connection", &wh)
	assert.Equal(t, false, wh["connected"])
}

func TestCloudUpdatePreservesCredentialsOnPartialUpdate(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	put := func(payload map[string]any) *http.Response {
		body := mustJSON(t, payload)
		req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/cloud_connection", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, _ := http.DefaultClient.Do(req)
		return resp
	}

	resp := put(map[string]any{"api_token": "tok", "sandbox_id": 9001, "mirror_enabled": false})
	_ = resp.Body.Close()

	resp = put(map[string]any{"mirror_enabled": true})
	defer func() { _ = resp.Body.Close() }()
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var cloud map[string]any
	getJSON(t, ts.URL+"/api/v1/cloud_connection", &cloud)
	assert.Equal(t, true, cloud["mirror_enabled"])
	assert.InEpsilon(t, float64(9001), cloud["sandbox_id"], 0)

	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/cloud_connection", nil)
	r, err := http.DefaultClient.Do(req)
	if r != nil {
		_ = r.Body.Close()
	}
	require.NoError(t, err)
	resp = put(map[string]any{"mirror_enabled": true})
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, resp.StatusCode)
}

func TestIngestFiresOnIngestHook(t *testing.T) {
	t.Parallel()
	srv, ts := newTestServer(t)

	var got string
	srv.OnIngest = func(id string) { got = id }

	id := ingestSample(t, ts.URL, "x", "a@x", "b@y", "")
	assert.Equal(t, id, got)
}

func TestSecurityHeadersNosniff(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)
	resp, err := http.Get(ts.URL + "/api/v1/messages")
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, "nosniff", resp.Header.Get("X-Content-Type-Options"))
}

func TestCORSEchoesOnlyLoopbackOrigins(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	do := func(origin string) string {
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/v1/messages", nil)
		req.Header.Set("Origin", origin)
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		_ = resp.Body.Close()
		return resp.Header.Get("Access-Control-Allow-Origin")
	}

	assert.Equal(t, "http://127.0.0.1:3540", do("http://127.0.0.1:3540"))
	assert.Equal(t, "http://localhost:3540", do("http://localhost:3540"))
	assert.Empty(t, do("https://evil.example"))
}

func TestPartServedAsSanitizedAttachmentWithCSP(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	payload := mustJSON(t, store.IngestPayload{
		SMTPFrom: "a@x", SMTPTo: []string{"b@y"},
		From:    &store.Address{Address: "a@x"},
		To:      []store.Address{{Address: "b@y"}},
		Subject: "with attachment",
		Raw:     []byte("From: a@x\r\nSubject: with attachment\r\n\r\nbody\r\n"),
		Attachments: []store.PartIn{{
			PartID:      "1",
			Filename:    `evil".html`,
			ContentType: "text/html",
			Content:     []byte("<script>alert(1)</script>"),
			Size:        25,
		}},
	})
	resp, err := http.Post(ts.URL+"/api/v1/ingest", "application/json", bytes.NewReader(payload))
	require.NoError(t, err)
	var created struct{ ID string }
	_ = json.NewDecoder(resp.Body).Decode(&created)
	_ = resp.Body.Close()

	r, err := http.Get(ts.URL + "/api/v1/message/" + created.ID + "/part/1")
	require.NoError(t, err)
	defer func() { _ = r.Body.Close() }()

	cd := r.Header.Get("Content-Disposition")
	assert.True(t, strings.HasPrefix(cd, "attachment;"))
	assert.NotContains(t, cd, `evil".html`)
	assert.Contains(t, cd, "evil.html")
	assert.Contains(t, r.Header.Get("Content-Security-Policy"), "default-src 'none'")
	assert.Equal(t, "nosniff", r.Header.Get("X-Content-Type-Options"))
}
