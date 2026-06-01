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
)

// helper: build a Server backed by an in-memory store + httptest server.
func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	st, err := store.OpenMemory()
	if err != nil {
		t.Fatalf("open memory store: %v", err)
	}
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
	payload, _ := json.Marshal(store.IngestPayload{
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
	if err != nil {
		t.Fatalf("post ingest: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("ingest %d: %s", resp.StatusCode, body)
	}
	var out struct{ ID string }
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.ID
}

// getJSON unmarshals a GET into v.
func getJSON(t *testing.T, url string, v any) int {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("get %s: %v", url, err)
	}
	defer resp.Body.Close()
	if v != nil {
		_ = json.NewDecoder(resp.Body).Decode(v)
	}
	return resp.StatusCode
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

func TestListEndpointEnvelope(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	ingestSample(t, ts.URL, "Welcome", "a@x.test", "b@y.test", "welcome")

	var resp MessagesResponse
	if code := getJSON(t, ts.URL+"/api/v1/messages", &resp); code != 200 {
		t.Fatalf("status %d", code)
	}
	if resp.Total != 1 || resp.Count != 1 || resp.Unread != 1 {
		t.Errorf("envelope counts: %+v", resp)
	}
	if len(resp.Messages) != 1 {
		t.Fatalf("messages length = %d, want 1", len(resp.Messages))
	}
	got := resp.Messages[0]
	if got.Subject != "Welcome" {
		t.Errorf("Subject = %q, want Welcome", got.Subject)
	}
	if !equalSliceStr(got.Tags, []string{"welcome"}) {
		t.Errorf("Tags = %v, want [welcome]", got.Tags)
	}
	if got.From.Address != "a@x.test" {
		t.Errorf("From.Address = %q", got.From.Address)
	}
	if got.Read {
		t.Errorf("Read = true on fresh insert; want false")
	}
}

func TestGetMessageMarksAsRead(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	id := ingestSample(t, ts.URL, "x", "a@x", "b@y", "")

	var detail MessageDetail
	getJSON(t, ts.URL+"/api/v1/message/"+id, &detail)

	// Now /messages should report 0 unread.
	var listResp MessagesResponse
	getJSON(t, ts.URL+"/api/v1/messages", &listResp)
	if listResp.Unread != 0 {
		t.Errorf("Unread after GET = %d, want 0", listResp.Unread)
	}
}

func TestRawHeadersEndpoints(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	id := ingestSample(t, ts.URL, "Subject Test", "a@x", "b@y", "")

	// Raw
	resp, err := http.Get(ts.URL + "/api/v1/message/" + id + "/raw")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), "Subject: Subject Test") {
		t.Errorf("raw body missing subject; got: %s", body)
	}
	if !strings.Contains(resp.Header.Get("Content-Disposition"), "inline") {
		t.Errorf("raw without ?dl should be inline; got %q", resp.Header.Get("Content-Disposition"))
	}

	// Headers
	var hdrs map[string][]string
	getJSON(t, ts.URL+"/api/v1/message/"+id+"/headers", &hdrs)
	if len(hdrs["Subject"]) == 0 || hdrs["Subject"][0] != "Subject Test" {
		t.Errorf("headers Subject = %v", hdrs["Subject"])
	}
}

func TestSearchEndpoint(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	ingestSample(t, ts.URL, "Welcome aboard", "a@x", "alice@y", "welcome")
	ingestSample(t, ts.URL, "Reset password", "auth@x", "alice@y", "transactional")

	var resp MessagesResponse
	getJSON(t, ts.URL+"/api/v1/search?query=welcome", &resp)
	if resp.Total != 1 || resp.Messages[0].Subject != "Welcome aboard" {
		t.Errorf("search welcome: %+v", resp)
	}

	// Empty query → empty result, but envelope still has tags
	getJSON(t, ts.URL+"/api/v1/search?query=", &resp)
	if resp.Total != 0 || len(resp.Messages) != 0 {
		t.Errorf("blank query should return 0; got %+v", resp)
	}
	if !equalSliceStr(resp.Tags, []string{"transactional", "welcome"}) {
		t.Errorf("blank-query tags = %v", resp.Tags)
	}
}

func TestDeleteAndReadToggle(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	id1 := ingestSample(t, ts.URL, "a", "a@x", "b@y", "")
	id2 := ingestSample(t, ts.URL, "b", "a@x", "b@y", "")
	_ = ingestSample(t, ts.URL, "c", "a@x", "b@y", "")

	// Bulk read
	body, _ := json.Marshal(map[string]any{"read": true})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	var listResp MessagesResponse
	getJSON(t, ts.URL+"/api/v1/messages", &listResp)
	if listResp.Unread != 0 {
		t.Errorf("after bulk-read, unread = %d, want 0", listResp.Unread)
	}

	// Delete two by id
	delBody, _ := json.Marshal(map[string]any{"ids": []string{id1, id2}})
	req, _ = http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/messages", bytes.NewReader(delBody))
	req.Header.Set("Content-Type", "application/json")
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()

	getJSON(t, ts.URL+"/api/v1/messages", &listResp)
	if listResp.Total != 1 {
		t.Errorf("after delete-2, total = %d, want 1", listResp.Total)
	}

	// Delete all — must use the explicit {"all":true} signal.
	allBody, _ := json.Marshal(map[string]any{"all": true})
	req, _ = http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/messages", bytes.NewReader(allBody))
	req.Header.Set("Content-Type", "application/json")
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	getJSON(t, ts.URL+"/api/v1/messages", &listResp)
	if listResp.Total != 0 {
		t.Errorf("after delete-all, total = %d, want 0", listResp.Total)
	}
}

// TestDeleteMessagesRequiresExplicitSignal pins the safety contract on
// DELETE /api/v1/messages: every shape that doesn't unambiguously mean
// "delete these" or "wipe the sandbox" must be rejected and must not
// touch the DB.
//
// Regression for the silent-decode bug Leonid caught: an earlier
// version of destroyMessages swallowed json.NewDecoder().Decode()
// errors, then fell through to Delete(ctx) with empty ids — which
// store.Delete interprets as "wipe everything". A typo in a curl
// request was enough to truncate the user's mailbox.
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
		wantMsg string // substring to find in the error body
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
			wantMsg: "decode body",
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
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != c.wantSC {
				t.Errorf("status = %d, want %d", resp.StatusCode, c.wantSC)
			}
			raw, _ := io.ReadAll(resp.Body)
			if !bytes.Contains(raw, []byte(c.wantMsg)) {
				t.Errorf("body missing %q\n  got: %s", c.wantMsg, raw)
			}

			// The critical assertion: nothing got deleted.
			var listResp MessagesResponse
			getJSON(t, ts.URL+"/api/v1/messages", &listResp)
			if listResp.Total != 2 {
				t.Errorf("malformed delete request truncated the mailbox: total = %d, want 2",
					listResp.Total)
			}
		})
	}
}

func TestDocsRedirect(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	// Don't follow redirects.
	c := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := c.Get(ts.URL + "/api/v1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusFound {
		t.Errorf("status = %d, want 302", resp.StatusCode)
	}
	if resp.Header.Get("Location") != "https://docs.mailtrap.io/" {
		t.Errorf("Location = %q", resp.Header.Get("Location"))
	}
}

func TestOpenAPIYAML(t *testing.T) {
	t.Parallel()
	srv, ts := newTestServer(t)
	srv.OpenAPI = []byte("openapi: 3.1.0\ninfo:\n  title: test\n")

	resp, err := http.Get(ts.URL + "/api/v1/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Errorf("status = %d", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Content-Type"), "yaml") {
		t.Errorf("Content-Type = %q", resp.Header.Get("Content-Type"))
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.HasPrefix(string(body), "openapi: 3.1.0") {
		t.Errorf("body doesn't start with openapi: 3.1.0; got: %q", body[:min(40, len(body))])
	}
}

func TestConnectionsCRUD(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	// Cloud
	body, _ := json.Marshal(map[string]any{
		"api_token": "tok", "sandbox_id": 9001, "mirror_enabled": true,
	})
	req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/cloud_connection", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()

	var cloud map[string]any
	getJSON(t, ts.URL+"/api/v1/cloud_connection", &cloud)
	if cloud["connected"] != true {
		t.Errorf("cloud connected = %v", cloud["connected"])
	}

	// Webhook
	body, _ = json.Marshal(map[string]any{
		"url": "https://hooks.example.com/x", "secret": "shh", "enabled": true,
	})
	req, _ = http.NewRequest(http.MethodPut, ts.URL+"/api/v1/webhook_connection", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()

	var wh map[string]any
	getJSON(t, ts.URL+"/api/v1/webhook_connection", &wh)
	if wh["connected"] != true || wh["enabled"] != true {
		t.Errorf("webhook = %+v", wh)
	}
	// secret must NEVER appear in the response
	if _, has := wh["secret"]; has {
		t.Errorf("webhook response leaks 'secret' field")
	}
}

// QA caught a bug: once a cloud token was saved, toggling mirror_enabled
// via the dialog (which omits the token field) errored with "api_token
// and sandbox_id are required". The handler must preserve existing
// credentials on partial updates.
func TestCloudUpdatePreservesCredentialsOnPartialUpdate(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	put := func(payload map[string]any) *http.Response {
		body, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/v1/cloud_connection", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, _ := http.DefaultClient.Do(req)
		return resp
	}

	// Initial connect with full credentials.
	resp := put(map[string]any{"api_token": "tok", "sandbox_id": 9001, "mirror_enabled": false})
	resp.Body.Close()

	// Partial update: only mirror_enabled — token and sandbox omitted.
	resp = put(map[string]any{"mirror_enabled": true})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("partial update status = %d, want 200", resp.StatusCode)
	}

	var cloud map[string]any
	getJSON(t, ts.URL+"/api/v1/cloud_connection", &cloud)
	if cloud["mirror_enabled"] != true {
		t.Errorf("mirror_enabled not flipped: %+v", cloud)
	}
	if cloud["sandbox_id"].(float64) != 9001 {
		t.Errorf("sandbox_id changed: %+v", cloud)
	}

	// Sanity: updating with no existing connection still requires both.
	if err := func() error {
		req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/api/v1/cloud_connection", nil)
		r, err := http.DefaultClient.Do(req)
		if r != nil {
			r.Body.Close()
		}
		return err
	}(); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	resp = put(map[string]any{"mirror_enabled": true})
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("partial update with no existing conn status = %d, want 422", resp.StatusCode)
	}
}

// OnIngest fires after a successful POST /api/v1/ingest.
func TestIngestFiresOnIngestHook(t *testing.T) {
	t.Parallel()
	srv, ts := newTestServer(t)

	var got string
	srv.OnIngest = func(id string) { got = id }

	id := ingestSample(t, ts.URL, "x", "a@x", "b@y", "")
	// Hook is synchronous (called from the handler); no goroutine
	// ordering concern.
	if got == "" || got != id {
		t.Errorf("OnIngest got = %q, want %q", got, id)
	}
}

// ---------------------------------------------------------------------

func equalSliceStr(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
