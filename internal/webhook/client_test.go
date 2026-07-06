package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// captured records the request the test server received. Tests assert
// against these fields after Deliver / SendTestPing.
type captured struct {
	method     string
	body       []byte
	contentTyp string
	signature  string
	event      string
	userAgent  string
}

// newServer spins up an httptest receiver. statusCode = 0 ⇒ default 200.
func newServer(t *testing.T, statusCode int, respBody string) (*httptest.Server, *captured) {
	t.Helper()
	c := &captured{}
	if statusCode == 0 {
		statusCode = http.StatusOK
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.method = r.Method
		c.contentTyp = r.Header.Get("Content-Type")
		c.signature = r.Header.Get("X-Mailtrap-Local-Signature")
		c.event = r.Header.Get("X-Mailtrap-Local-Event")
		c.userAgent = r.Header.Get("User-Agent")
		c.body, _ = io.ReadAll(r.Body)
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(respBody))
	}))
	t.Cleanup(srv.Close)
	return srv, c
}

func expectedSignature(secret, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestDeliverSendsPOSTWithExpectedHeaders(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()
	body := []byte(`{"id":"m1","subject":"hi"}`)

	require.NoError(t, c.Deliver(context.Background(), srv.URL, "", body))
	assert.Equal(t, http.MethodPost, got.method)
	assert.Equal(t, "application/json", got.contentTyp)
	assert.Equal(t, "message.created", got.event)
	assert.True(t, strings.HasPrefix(got.userAgent, "mailtrap-local-webhook/"))
	assert.Equal(t, string(body), string(got.body))
	assert.Empty(t, got.signature)
}

func TestDeliverHMACSignatureMatchesPayload(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()
	body := []byte(`{"id":"m2"}`)
	const secret = "shared-secret-XYZ"

	require.NoError(t, c.Deliver(context.Background(), srv.URL, secret, body))
	assert.Equal(t, expectedSignature(secret, string(body)), got.signature)
}

// TestSignatureChangesWithBody — different bodies (or different
// secrets) MUST produce different signatures. Anything else is a
// security regression: a stable signature lets an attacker replay an
// old body against a new secret, or vice versa.
func TestSignatureChangesWithBody(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()

	require.NoError(t, c.Deliver(context.Background(), srv.URL, "k", []byte(`{"a":1}`)))
	first := got.signature

	require.NoError(t, c.Deliver(context.Background(), srv.URL, "k", []byte(`{"a":2}`)))
	assert.NotEqual(t, first, got.signature)
}

func TestDeliverPermanentErrorOn4xx(t *testing.T) {
	t.Parallel()
	srv, _ := newServer(t, http.StatusBadRequest, "bad shape")
	c := NewClient()
	err := c.Deliver(context.Background(), srv.URL, "", []byte(`{}`))
	var perm *PermanentError
	require.ErrorAs(t, err, &perm)
	assert.Contains(t, perm.Error(), strconv.Itoa(http.StatusBadRequest))
}

func TestDeliverTransientErrorOn5xx(t *testing.T) {
	t.Parallel()
	srv, _ := newServer(t, http.StatusInternalServerError, "boom")
	c := NewClient()
	err := c.Deliver(context.Background(), srv.URL, "", []byte(`{}`))
	require.Error(t, err)
	var perm *PermanentError
	assert.NotErrorAs(t, err, &perm)
}

func TestDeliverNetworkErrorIsTransient(t *testing.T) {
	t.Parallel()
	c := NewClient()
	err := c.Deliver(context.Background(), "http://127.0.0.1:1/x", "", []byte(`{}`))
	require.Error(t, err)
	var perm *PermanentError
	assert.NotErrorAs(t, err, &perm)
}

func TestDeliverInvalidURLReturnsError(t *testing.T) {
	t.Parallel()
	c := NewClient()
	err := c.Deliver(context.Background(), "://broken", "", []byte(`{}`))
	assert.Error(t, err)
}

func TestSendTestPingPostsTestEvent(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()
	require.NoError(t, c.SendTestPing(context.Background(), srv.URL, ""))
	assert.Equal(t, "test", got.event)
	assert.Contains(t, string(got.body), "Test ping from mailtrap-local")
}

func TestSendTestPingSignsBodyWhenSecretSet(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()
	require.NoError(t, c.SendTestPing(context.Background(), srv.URL, "ping-secret"))
	assert.Equal(t, expectedSignature("ping-secret", string(got.body)), got.signature)
}

// Sanity that the production NewClient enforces a real timeout — a
// missed timeout would block the dispatcher Goroutines on a hung
// receiver.
func TestNewClientHasTimeout(t *testing.T) {
	c := NewClient()
	assert.NotZero(t, c.HTTP.Timeout)
}
