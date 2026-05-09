package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
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

	if err := c.Deliver(context.Background(), srv.URL, "", body); err != nil {
		t.Fatalf("Deliver: %v", err)
	}
	if got.method != http.MethodPost {
		t.Errorf("method = %q, want POST", got.method)
	}
	if got.contentTyp != "application/json" {
		t.Errorf("Content-Type = %q", got.contentTyp)
	}
	if got.event != "message.created" {
		t.Errorf("X-Mailtrap-Local-Event = %q, want message.created", got.event)
	}
	if !strings.HasPrefix(got.userAgent, "mailtrap-local-webhook/") {
		t.Errorf("User-Agent = %q, want mailtrap-local-webhook/...", got.userAgent)
	}
	if string(got.body) != string(body) {
		t.Errorf("body roundtrip mismatch\n got: %s\nwant: %s", got.body, body)
	}
	if got.signature != "" {
		t.Errorf("signature should be empty when no secret; got %q", got.signature)
	}
}

func TestDeliverHMACSignatureMatchesPayload(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()
	body := []byte(`{"id":"m2"}`)
	const secret = "shared-secret-XYZ"

	if err := c.Deliver(context.Background(), srv.URL, secret, body); err != nil {
		t.Fatal(err)
	}

	want := expectedSignature(secret, string(body))
	if got.signature != want {
		t.Errorf("signature = %q\n   want = %q", got.signature, want)
	}
}

// TestSignatureChangesWithBody — different bodies (or different
// secrets) MUST produce different signatures. Anything else is a
// security regression: a stable signature lets an attacker replay an
// old body against a new secret, or vice versa.
func TestSignatureChangesWithBody(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()

	if err := c.Deliver(context.Background(), srv.URL, "k", []byte(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	first := got.signature

	if err := c.Deliver(context.Background(), srv.URL, "k", []byte(`{"a":2}`)); err != nil {
		t.Fatal(err)
	}
	second := got.signature

	if first == second {
		t.Errorf("signatures collide across different bodies: %q", first)
	}
}

func TestDeliverPermanentErrorOn4xx(t *testing.T) {
	t.Parallel()
	srv, _ := newServer(t, http.StatusBadRequest, "bad shape")
	c := NewClient()
	err := c.Deliver(context.Background(), srv.URL, "", []byte(`{}`))
	var perm *PermanentError
	if !errors.As(err, &perm) {
		t.Fatalf("expected *PermanentError on 4xx, got %T: %v", err, err)
	}
	if !strings.Contains(perm.Error(), strconv.Itoa(http.StatusBadRequest)) {
		t.Errorf("error missing status code: %q", perm.Error())
	}
}

func TestDeliverTransientErrorOn5xx(t *testing.T) {
	t.Parallel()
	srv, _ := newServer(t, http.StatusInternalServerError, "boom")
	c := NewClient()
	err := c.Deliver(context.Background(), srv.URL, "", []byte(`{}`))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	var perm *PermanentError
	if errors.As(err, &perm) {
		t.Errorf("5xx must NOT be PermanentError; got %v", err)
	}
}

func TestDeliverNetworkErrorIsTransient(t *testing.T) {
	t.Parallel()
	c := NewClient()
	err := c.Deliver(context.Background(), "http://127.0.0.1:1/x", "", []byte(`{}`))
	if err == nil {
		t.Fatal("expected error against closed port, got nil")
	}
	var perm *PermanentError
	if errors.As(err, &perm) {
		t.Errorf("network error must NOT be PermanentError; got %v", err)
	}
}

func TestDeliverInvalidURLReturnsError(t *testing.T) {
	t.Parallel()
	c := NewClient()
	if err := c.Deliver(context.Background(), "://broken", "", []byte(`{}`)); err == nil {
		t.Errorf("expected error for malformed URL, got nil")
	}
}

func TestSendTestPingPostsTestEvent(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()
	if err := c.SendTestPing(context.Background(), srv.URL, ""); err != nil {
		t.Fatalf("SendTestPing: %v", err)
	}
	if got.event != "test" {
		t.Errorf("event = %q, want test", got.event)
	}
	if !strings.Contains(string(got.body), "Test ping from mailtrap-local") {
		t.Errorf("test ping body missing expected subject: %s", got.body)
	}
}

func TestSendTestPingSignsBodyWhenSecretSet(t *testing.T) {
	t.Parallel()
	srv, got := newServer(t, 0, "")
	c := NewClient()
	if err := c.SendTestPing(context.Background(), srv.URL, "ping-secret"); err != nil {
		t.Fatal(err)
	}
	want := expectedSignature("ping-secret", string(got.body))
	if got.signature != want {
		t.Errorf("ping signature mismatch:\n  got: %q\n want: %q", got.signature, want)
	}
}

// Sanity that the production NewClient enforces a real timeout — a
// missed timeout would block the dispatcher Goroutines on a hung
// receiver.
func TestNewClientHasTimeout(t *testing.T) {
	c := NewClient()
	if c.HTTP.Timeout == 0 {
		t.Errorf("NewClient should set a non-zero HTTP timeout (got 0)")
	}
}
