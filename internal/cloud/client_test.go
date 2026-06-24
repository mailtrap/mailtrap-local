package cloud

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubServer captures the last POST so tests can assert on the URL,
// headers, and body Mailtrap's Send API would have received.
type stubServer struct {
	*httptest.Server

	lastMethod string
	lastPath   string
	lastAuth   string
	lastCT     string
	lastAccept string
	lastBody   []byte
	statusCode int    // response code; default 200
	respBody   string // response body; default `{}`
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
	require.NoError(t, c.Send(context.Background(), minMsg(), nil, nil))
	assert.Equal(t, http.MethodPost, stub.lastMethod)
	assert.Equal(t, "/api/send/42", stub.lastPath)
	assert.Equal(t, "Bearer tok", stub.lastAuth)
	assert.Equal(t, "application/json", stub.lastCT)
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
	require.NoError(t, c.Send(context.Background(), msg, nil, nil))

	var got map[string]any
	require.NoError(t, json.Unmarshal(stub.lastBody, &got))

	from, ok := got["from"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "app@x.test", from["email"])
	assert.Equal(t, "App", from["name"])
	to, ok := got["to"].([]any)
	require.True(t, ok)
	require.Len(t, to, 1)
	first, ok := to[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "alice@y.test", first["email"])
	assert.Equal(t, "Alice", first["name"])
	assert.Equal(t, "Welcome", got["subject"])
	assert.Equal(t, "plain", got["text"])
	assert.Equal(t, "<b>html</b>", got["html"])
	assert.Equal(t, "welcome", got["category"])
	assert.Contains(t, got, "cc")
	assert.Contains(t, got, "bcc")
}

func TestSendOmitsEmptyCcBcc(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "t", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}
	require.NoError(t, c.Send(context.Background(), minMsg(), nil, nil))

	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	assert.NotContains(t, got, "cc")
	assert.NotContains(t, got, "bcc")
}

func TestSendFallsBackToEmptyTextWhenBothBodiesAbsent(t *testing.T) {
	t.Parallel()
	stub := newStub(t)
	c := &Client{APIToken: "t", SandboxID: 1, BaseURL: stub.URL, HTTP: http.DefaultClient}

	msg := &store.Message{
		FromAddress: "f@x", ToAddresses: []store.Address{{Address: "t@x"}},
		Subject: "no-body",
	}
	require.NoError(t, c.Send(context.Background(), msg, nil, nil))
	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	assert.Empty(t, got["text"])
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
	require.NoError(t, c.Send(context.Background(), minMsg(), nil, atts))

	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	rawAtts, ok := got["attachments"].([]any)
	require.True(t, ok)
	require.Len(t, rawAtts, 1)
	first, ok := rawAtts[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "report.pdf", first["filename"])
	assert.Equal(t, "application/pdf", first["type"])
	assert.Equal(t, "attachment", first["disposition"])
	encoded, ok := first["content"].(string)
	require.True(t, ok)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)
	assert.Equal(t, "fake-pdf-bytes", string(decoded))
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
	require.NoError(t, c.Send(context.Background(), minMsg(), inline, nil))
	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	atts, ok := got["attachments"].([]any)
	require.True(t, ok)
	first, ok := atts[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "inline", first["disposition"])
	assert.Equal(t, "img1@x", first["content_id"])
	assert.Equal(t, "img1@x", first["filename"])
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
	require.NoError(t, c.Send(context.Background(), msg, nil, nil))
	var got map[string]any
	_ = json.Unmarshal(stub.lastBody, &got)
	headers, ok := got["headers"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "trace-abc", headers["X-Trace-Id"])
	assert.Equal(t, "original@x", headers["X-Original-From"])
	for _, k := range []string{"From", "To", "Subject", "Message-Id", "Category"} {
		assert.NotContains(t, headers, k)
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
	require.Error(t, err)
	var perm *PermanentError
	require.ErrorAs(t, err, &perm)
	assert.Contains(t, perm.Error(), strconv.Itoa(http.StatusUnauthorized))
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
	require.Error(t, err)
	var perm *PermanentError
	assert.NotErrorAs(t, err, &perm)
}

func TestSendNetworkErrorIsTransient(t *testing.T) {
	t.Parallel()
	c := &Client{
		APIToken: "t", SandboxID: 1,
		BaseURL: "http://127.0.0.1:1", // closed port
		HTTP:    http.DefaultClient,
	}
	err := c.Send(context.Background(), minMsg(), nil, nil)
	require.Error(t, err)
	var perm *PermanentError
	assert.NotErrorAs(t, err, &perm)
}
