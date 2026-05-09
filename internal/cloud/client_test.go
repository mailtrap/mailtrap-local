package cloud

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/mailtrap/mailtrap-local/internal/store"
)

// stubServer captures the last POST so tests can assert on the URL,
// headers, and body Mailtrap's Send API would have received.
type stubServer struct {
	*httptest.Server
	mu          func() // unused placeholder; we sync via channels not locks
	lastMethod  string
	lastPath    string
	lastAuth    string
	lastCT      string
	lastAccept  string
	lastBody    []byte
	statusCode  int    // response code; default 200
	respBody    string // response body; default `{}`
}

func newStub(t *testing.T) *stubServer {
	t.Helper()
	s := &stubServer{statusCode: 200, respBody: `{"id":"sandbox-msg-1"}`}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.lastMethod = r.Method
		s.lastPath = r.URL.Path
		s.lastAuth = r.Header.Get("Authorization")
		s.lastCT = r.Header.Get("Content-Type")
		s.lastAccept = r.Header.Get("Accept")
		body, _ := io.ReadAll(r.Body)
		s.lastBody = body
		w.WriteHeader(s.statusCode)
		_, _ = w.Write([]byte(s.respBody))
	}))
	t.Cleanup(s.Close)
	return s
}

// helper — minimal `*store.Message` for round-trip tests.
func minMsg() *store.Message {
	return &store.Message{
		ID:          "m1",
		FromName:    "Sender",
		FromAddress: "from@example.com",
		ToAddresses: []store.Address{{Address: "to@example.com"}},
		Subject:     "Hello",
		TextBody:    "hi there",
		HTML:        "<p>hi there</p>",
	}
}

func TestSendHappyPath(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "tok", SandboxID: 42, BaseURL: stub.URL, HTTP: http.DefaultClient}
	if err := c.Send(context.Background(), minMsg(), nil, nil); err != nil {
		t.Fatalf("send: %v", err)
	}
	if stub.lastMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", stub.lastMethod)
	}
	if stub.lastPath != "/api/send/42" {
		t.Errorf("path = %q, want /api/send/42", stub.lastPath)
	}
	if stub.lastAuth != "Bearer tok" {
		t.Errorf("auth header = %q, want \"Bearer tok\"", stub.lastAuth)
	}
	if stub.lastCT != "application/json" {
		t.Errorf("content-type = %q, want application/json", stub.lastCT)
	}
}

func TestSendBuildsExpectedPayload(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "tok", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}

	cat := "welcome"
	msg := &store.Message{
		FromName: "App", FromAddress: "app@x.test",
		ToAddresses:  []store.Address{{Name: "Alice", Address: "alice@y.test"}},
		CcAddresses:  []store.Address{{Address: "cc@y.test"}},
		BccAddresses: []store.Address{{Address: "bcc@y.test"}},
		Subject:      "Welcome",
		TextBody:     "plain",
		HTML:         "<b>html</b>",
		Category:     &cat,
	}
	if err := c.Send(context.Background(), msg, nil, nil); err != nil {
		t.Fatal(err)
	}

	var got map[string]any
	if err := json.Unmarshal(stub.lastBody, &got); err != nil {
		t.Fatalf("unmarshal body: %v\n%s", err, stub.lastBody)
	}

	from := got["from"].(map[string]any)
	if from["email"] != "app@x.test" || from["name"] != "App" {
		t.Errorf("from = %+v", from)
	}
	to := got["to"].([]any)
	if len(to) != 1 {
		t.Fatalf("to count = %d, want 1", len(to))
	}
	first := to[0].(map[string]any)
	if first["email"] != "alice@y.test" || first["name"] != "Alice" {
		t.Errorf("to[0] = %+v", first)
	}
	if got["subject"] != "Welcome" {
		t.Errorf("subject = %v", got["subject"])
	}
	if got["text"] != "plain" {
		t.Errorf("text = %v", got["text"])
	}
	if got["html"] != "<b>html</b>" {
		t.Errorf("html = %v", got["html"])
	}
	if got["category"] != "welcome" {
		t.Errorf("category = %v, want welcome (promoted to top-level)", got["category"])
	}
	if _, ok := got["cc"]; !ok {
		t.Errorf("cc absent — should appear when set")
	}
	if _, ok := got["bcc"]; !ok {
		t.Errorf("bcc absent — should appear when set")
	}
}

func TestSendOmitsEmptyCcBcc(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "t", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}
	if err := c.Send(context.Background(), minMsg(), nil, nil); err != nil {
		t.Fatal(err)
	}

	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	if _, ok := got["cc"]; ok {
		t.Errorf("empty cc should be omitted from payload")
	}
	if _, ok := got["bcc"]; ok {
		t.Errorf("empty bcc should be omitted from payload")
	}
}

func TestSendFallsBackToEmptyTextWhenBothBodiesAbsent(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "t", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}

	msg := &store.Message{
		FromAddress: "f@x", ToAddresses: []store.Address{{Address: "t@x"}},
		Subject: "no-body",
	}
	if err := c.Send(context.Background(), msg, nil, nil); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	if got["text"] != "" {
		t.Errorf("text = %v, want \"\" fallback (Mailtrap rejects no-body)", got["text"])
	}
}

func TestSendAttachmentsBase64Encoded(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "t", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}

	atts := []store.Part{
		{
			PartID:      "1",
			Filename:    "report.pdf",
			ContentType: "application/pdf",
			Content:     []byte("fake-pdf-bytes"),
		},
	}
	if err := c.Send(context.Background(), minMsg(), nil, atts); err != nil {
		t.Fatal(err)
	}

	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	rawAtts, ok := got["attachments"].([]any)
	if !ok || len(rawAtts) != 1 {
		t.Fatalf("attachments shape: %+v", got["attachments"])
	}
	first := rawAtts[0].(map[string]any)
	if first["filename"] != "report.pdf" {
		t.Errorf("filename = %v", first["filename"])
	}
	if first["type"] != "application/pdf" {
		t.Errorf("type = %v", first["type"])
	}
	if first["disposition"] != "attachment" {
		t.Errorf("disposition = %v, want attachment", first["disposition"])
	}
	encoded := first["content"].(string)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("attachment content not valid base64: %v", err)
	}
	if string(decoded) != "fake-pdf-bytes" {
		t.Errorf("decoded content = %q, want fake-pdf-bytes", decoded)
	}
}

func TestSendInlinePartsMarkedDispositionInline(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "t", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}

	inline := []store.Part{
		{
			PartID:      "i1",
			ContentType: "image/png",
			ContentID:   "<img1@x>",
			Disposition: "inline",
			Content:     []byte("PNG-BYTES"),
		},
	}
	if err := c.Send(context.Background(), minMsg(), inline, nil); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	atts := got["attachments"].([]any)
	first := atts[0].(map[string]any)
	if first["disposition"] != "inline" {
		t.Errorf("disposition = %v, want inline", first["disposition"])
	}
	if first["content_id"] != "img1@x" {
		t.Errorf("content_id = %v, want img1@x (angle brackets stripped)", first["content_id"])
	}
	// Filename fallback: when Filename is empty the code uses the
	// stripped Content-ID. Confirms the fallback path.
	if first["filename"] != "img1@x" {
		t.Errorf("filename fallback = %v, want img1@x", first["filename"])
	}
}

func TestSendCustomHeadersExtracted(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "t", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}

	raw := []byte("From: a@x\r\n" +
		"To: b@y\r\n" +
		"Subject: hi\r\n" +
		"Message-ID: <m1@x>\r\n" +
		"X-Trace-Id: trace-abc\r\n" +
		"X-Original-From: original@x\r\n" +
		"Category: should-be-stripped\r\n" + // reserved — promoted to top-level instead
		"\r\n" +
		"body\r\n")
	msg := minMsg()
	msg.Raw = raw
	if err := c.Send(context.Background(), msg, nil, nil); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	headers, ok := got["headers"].(map[string]any)
	if !ok {
		t.Fatalf("headers missing/wrong shape: %+v", got["headers"])
	}
	if headers["X-Trace-Id"] != "trace-abc" {
		t.Errorf("X-Trace-Id = %v", headers["X-Trace-Id"])
	}
	if headers["X-Original-From"] != "original@x" {
		t.Errorf("X-Original-From = %v", headers["X-Original-From"])
	}
	for _, k := range []string{"From", "To", "Subject", "Message-Id", "Category"} {
		if _, present := headers[k]; present {
			t.Errorf("reserved header %q leaked into headers map: %v", k, headers[k])
		}
	}
}

// TestSendPermanentErrorOn4xx — Mailtrap returns 4xx for bad token /
// disabled sandbox / malformed payload. Dispatcher uses ErrPermanent
// to skip retry; the test pins both the type AND the message.
func TestSendPermanentErrorOn4xx(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	stub.statusCode = http.StatusUnauthorized
	stub.respBody = `{"errors":["invalid api token"]}`
	c := &Client{APIToken: "bad", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}

	err := c.Send(context.Background(), minMsg(), nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	var perm *PermanentError
	if !errors.As(err, &perm) {
		t.Fatalf("expected *PermanentError, got %T: %v", err, err)
	}
	if !strings.Contains(perm.Error(), strconv.Itoa(http.StatusUnauthorized)) {
		t.Errorf("error message missing status code: %q", perm.Error())
	}
}

// TestSendTransientErrorOn5xx — 5xx + network blips are retryable.
// Dispatcher checks errors.As against PermanentError; a generic error
// here means "go ahead and retry on the next attempt".
func TestSendTransientErrorOn5xx(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	stub.statusCode = http.StatusBadGateway
	c := &Client{APIToken: "t", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}

	err := c.Send(context.Background(), minMsg(), nil, nil)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	var perm *PermanentError
	if errors.As(err, &perm) {
		t.Errorf("5xx should NOT be PermanentError; was %v", err)
	}
}

func TestSendNetworkErrorIsTransient(t *testing.T) {
	t.Parallel()
	c := &Client{
		APIToken: "t", SandboxID: 1,
		BaseURL: "http://127.0.0.1:1", // closed port
		HTTP:    http.DefaultClient,
	}
	err := c.Send(context.Background(), minMsg(), nil, nil)
	if err == nil {
		t.Fatal("expected network error, got nil")
	}
	var perm *PermanentError
	if errors.As(err, &perm) {
		t.Errorf("network errors should NOT be PermanentError; was %v", err)
	}
}
