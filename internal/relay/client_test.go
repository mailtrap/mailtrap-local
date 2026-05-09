package relay

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	stdsmtp "net/smtp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	smtp "github.com/emersion/go-smtp"
	"github.com/mailtrap/mailtrap-local/internal/store"
)

// ---------------------------------------------------------------------
// Test SMTP harness — emersion/go-smtp listening on a random loopback
// port. Records every transaction so tests can assert envelope sender,
// recipients, and DATA bytes.
// ---------------------------------------------------------------------

type captureBackend struct {
	mu   sync.Mutex
	tx   []capturedTx
	auth bool
}

type capturedTx struct {
	from string
	to   []string
	data []byte
}

func (b *captureBackend) NewSession(_ *smtp.Conn) (smtp.Session, error) {
	return &captureSession{b: b}, nil
}

type captureSession struct {
	b    *captureBackend
	from string
	to   []string
	got  bool
}

func (s *captureSession) Mail(from string, _ *smtp.MailOptions) error {
	s.from = from
	return nil
}
func (s *captureSession) Rcpt(to string, _ *smtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}
func (s *captureSession) Data(r io.Reader) error {
	raw, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.got = true
	s.b.mu.Lock()
	s.b.tx = append(s.b.tx, capturedTx{from: s.from, to: append([]string(nil), s.to...), data: raw})
	s.b.mu.Unlock()
	return nil
}
func (s *captureSession) Reset()        { s.from = ""; s.to = nil }
func (s *captureSession) Logout() error { return nil }

// startServer spawns the SMTP listener and returns its host:port plus
// the capture backend.
func startServer(t *testing.T) (host string, port int, be *captureBackend) {
	t.Helper()
	be = &captureBackend{}
	server := smtp.NewServer(be)
	server.Domain = "test"
	server.AllowInsecureAuth = true
	server.ReadTimeout = 5 * time.Second
	server.WriteTimeout = 5 * time.Second

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go func() { _ = server.Serve(l) }()
	t.Cleanup(func() {
		_ = server.Close()
		_ = l.Close()
	})
	addr := l.Addr().(*net.TCPAddr)
	return "127.0.0.1", addr.Port, be
}

func parsePort(s string) int {
	p, _ := strconv.Atoi(s)
	return p
}

// firstTx returns the most recent capture, or fails the test if there's
// nothing yet.
func (b *captureBackend) firstTx(t *testing.T) capturedTx {
	t.Helper()
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.tx) == 0 {
		t.Fatal("no transactions captured")
	}
	return b.tx[0]
}

// ---------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------

func TestProbeSuccess(t *testing.T) {
	t.Parallel()
	host, port, _ := startServer(t)
	c := &Client{}
	if err := c.Probe(context.Background(), host, port, "", "", "", "off"); err != nil {
		t.Errorf("probe: %v", err)
	}
}

func TestProbeFailsOnClosedPort(t *testing.T) {
	t.Parallel()
	c := &Client{}
	err := c.Probe(context.Background(), "127.0.0.1", 1, "", "", "", "off")
	if err == nil {
		t.Errorf("expected error against closed port, got nil")
	}
}

// ---------------------------------------------------------------------
// Forward — happy path + envelope plumbing
// ---------------------------------------------------------------------

const sampleRaw = "From: original@x.test\r\n" +
	"To: dropped@x.test\r\n" +
	"Subject: probe\r\n" +
	"\r\n" +
	"body line\r\n"

func newConn(host string, port int) *store.RelayConnection {
	return &store.RelayConnection{
		Host: host, Port: port,
		Auth: "none", TLS: "off",
	}
}

func newMsg() *store.Message {
	return &store.Message{
		FromAddress: "original@x.test",
		ToAddresses: []store.Address{{Address: "dropped@x.test"}},
		Raw:         []byte(sampleRaw),
	}
}

func TestForwardSingleRecipient(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	c := &Client{}
	if err := c.Forward(context.Background(), newConn(host, port), newMsg(),
		[]string{"new@y.test"},
	); err != nil {
		t.Fatalf("forward: %v", err)
	}

	tx := be.firstTx(t)
	if tx.from != "original@x.test" {
		t.Errorf("MAIL FROM = %q, want original@x.test", tx.from)
	}
	if len(tx.to) != 1 || tx.to[0] != "new@y.test" {
		t.Errorf("RCPT TO = %v, want [new@y.test]", tx.to)
	}
	if !bytes.Contains(tx.data, []byte("Subject: probe")) {
		t.Errorf("DATA missing Subject header; got: %q", tx.data)
	}
}

func TestForwardMultipleRecipients(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	c := &Client{}
	rcpts := []string{"a@y.test", "b@y.test", "c@y.test"}
	if err := c.Forward(context.Background(), newConn(host, port), newMsg(), rcpts); err != nil {
		t.Fatal(err)
	}
	tx := be.firstTx(t)
	if len(tx.to) != 3 {
		t.Errorf("RCPT TO count = %d, want 3 (got %v)", len(tx.to), tx.to)
	}
	for i, r := range rcpts {
		if tx.to[i] != r {
			t.Errorf("RCPT[%d] = %q, want %q", i, tx.to[i], r)
		}
	}
}

func TestForwardRejectsEmptyRecipientList(t *testing.T) {
	t.Parallel()
	c := &Client{}
	err := c.Forward(context.Background(), &store.RelayConnection{Host: "x", Port: 25}, newMsg(), nil)
	if err == nil || !strings.Contains(err.Error(), "no recipients") {
		t.Errorf("expected 'no recipients' error, got %v", err)
	}
}

func TestForwardOverridesFromHeaderAndStashesOriginal(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	conn := newConn(host, port)
	conn.OverrideFrom = "noreply@verified.test"
	c := &Client{}
	if err := c.Forward(context.Background(), conn, newMsg(), []string{"r@y.test"}); err != nil {
		t.Fatal(err)
	}
	tx := be.firstTx(t)
	if !bytes.Contains(tx.data, []byte("From: noreply@verified.test")) {
		t.Errorf("From header NOT rewritten; data:\n%s", tx.data)
	}
	if !bytes.Contains(tx.data, []byte("X-Original-From: original@x.test")) {
		t.Errorf("X-Original-From missing; data:\n%s", tx.data)
	}
	// Envelope sender (MAIL FROM) is independent of From-header
	// rewriting — it follows ReturnPath if set, else the original.
	if tx.from != "original@x.test" {
		t.Errorf("envelope From = %q, want original@x.test", tx.from)
	}
}

func TestForwardReturnPathRewritesEnvelopeSender(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	conn := newConn(host, port)
	conn.ReturnPath = "bounces@verified.test"
	c := &Client{}
	if err := c.Forward(context.Background(), conn, newMsg(), []string{"r@y.test"}); err != nil {
		t.Fatal(err)
	}
	tx := be.firstTx(t)
	if tx.from != "bounces@verified.test" {
		t.Errorf("envelope MAIL FROM = %q, want bounces@verified.test", tx.from)
	}
	// The DATA From: header is NOT rewritten by ReturnPath — only by
	// OverrideFrom.
	if !bytes.Contains(tx.data, []byte("From: original@x.test")) {
		t.Errorf("From header should remain unchanged; got:\n%s", tx.data)
	}
}

// ---------------------------------------------------------------------
// rewriteFromHeader — pure unit tests
// ---------------------------------------------------------------------

func TestRewriteFromHeaderReplacesFirstFrom(t *testing.T) {
	t.Parallel()
	in := []byte("From: orig@x\r\nTo: t@y\r\nSubject: hi\r\n\r\nbody\r\n")
	out := rewriteFromHeader(in, "new@x", "orig@x")
	if !bytes.Contains(out, []byte("From: new@x")) {
		t.Errorf("From not replaced: %s", out)
	}
	if !bytes.Contains(out, []byte("X-Original-From: orig@x")) {
		t.Errorf("X-Original-From not added: %s", out)
	}
	// Body preserved untouched.
	if !bytes.HasSuffix(out, []byte("\r\nbody\r\n")) {
		t.Errorf("body modified: %s", out)
	}
}

func TestRewriteFromHeaderDoesNotStackOriginalFrom(t *testing.T) {
	t.Parallel()
	in := []byte("From: orig@x\r\n" +
		"X-Original-From: stale@x\r\n" +
		"To: t@y\r\n\r\nbody\r\n")
	out := rewriteFromHeader(in, "new@x", "orig@x")
	count := bytes.Count(out, []byte("X-Original-From:"))
	if count != 1 {
		t.Errorf("X-Original-From count = %d, want 1 (must replace, not stack)\n%s", count, out)
	}
	if !bytes.Contains(out, []byte("X-Original-From: orig@x")) {
		t.Errorf("X-Original-From should reflect orig@x, not stale@x\n%s", out)
	}
}

func TestRewriteFromHeaderTouchesOnlyFirstFromOccurrence(t *testing.T) {
	t.Parallel()
	// Pathological: a literal "From:" line in the BODY should NOT be
	// touched. We split on "\r\n\r\n" so the body is left alone.
	in := []byte("From: orig@x\r\nSubject: re\r\n\r\nFrom: bystander@y\r\nbody\r\n")
	out := rewriteFromHeader(in, "new@x", "")
	if !bytes.Contains(out, []byte("\r\nFrom: bystander@y\r\n")) {
		t.Errorf("body 'From:' line was modified: %s", out)
	}
	if !bytes.HasPrefix(out, []byte("From: new@x")) {
		t.Errorf("header From not replaced: %s", out)
	}
}

func TestRewriteFromHeaderNoHeaderBodyBoundaryReturnsInput(t *testing.T) {
	t.Parallel()
	in := []byte("From: orig@x\r\n") // no \r\n\r\n
	out := rewriteFromHeader(in, "new@x", "orig@x")
	if !bytes.Equal(in, out) {
		t.Errorf("malformed input should pass through unchanged\nin:  %q\nout: %q", in, out)
	}
}

// ---------------------------------------------------------------------
// loginAuth — state machine
// ---------------------------------------------------------------------

func TestLoginAuthStartReturnsLOGIN(t *testing.T) {
	t.Parallel()
	a := loginAuth{"u", "p"}
	mech, init, err := a.Start(nil)
	if err != nil {
		t.Fatal(err)
	}
	if mech != "LOGIN" {
		t.Errorf("mechanism = %q, want LOGIN", mech)
	}
	if init != nil {
		t.Errorf("initial response should be nil for LOGIN; got %q", init)
	}
}

func TestLoginAuthNextHandlesUsernameAndPasswordChallenges(t *testing.T) {
	t.Parallel()
	a := loginAuth{"alice", "p4ssw0rd"}

	got, err := a.Next([]byte("Username:"), true)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "alice" {
		t.Errorf("Username response = %q, want alice", got)
	}

	got, err = a.Next([]byte("Password:"), true)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "p4ssw0rd" {
		t.Errorf("Password response = %q, want p4ssw0rd", got)
	}
}

func TestLoginAuthRejectsUnexpectedChallenge(t *testing.T) {
	t.Parallel()
	a := loginAuth{"u", "p"}
	_, err := a.Next([]byte("CaptchaBlue:"), true)
	if err == nil {
		t.Errorf("expected error on unexpected challenge")
	}
}

func TestLoginAuthNoMoreReturnsNil(t *testing.T) {
	t.Parallel()
	a := loginAuth{"u", "p"}
	got, err := a.Next(nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Errorf("response on !more should be nil; got %v", got)
	}
}

// ---------------------------------------------------------------------
// ParseAddrs
// ---------------------------------------------------------------------

func TestParseAddrsAcceptsValidAndDropsBad(t *testing.T) {
	t.Parallel()
	in := []string{"a@x.test", "Bob <b@y.test>", "not-an-email", "", "c@z.test"}
	out := ParseAddrs(in)
	if len(out) != 3 {
		t.Errorf("count = %d, want 3 (got %v)", len(out), out)
	}
	gotAddrs := []string{out[0].Address, out[1].Address, out[2].Address}
	want := []string{"a@x.test", "b@y.test", "c@z.test"}
	for i := range want {
		if gotAddrs[i] != want[i] {
			t.Errorf("address[%d] = %q, want %q", i, gotAddrs[i], want[i])
		}
	}
	if out[1].Name != "Bob" {
		t.Errorf("display name not parsed for %q", in[1])
	}
}

// ---------------------------------------------------------------------
// authenticate — selects the right mechanism
// ---------------------------------------------------------------------

// authPickStub captures the last Auth call so we can verify the right
// mechanism was used. It substitutes in for *smtp.Client via the
// authenticate signature — easier than a full SMTP roundtrip when all
// we want to check is the picker.
func TestAuthenticateNoCredsIsNoOp(t *testing.T) {
	t.Parallel()
	// `authenticate` short-circuits when both user and pass are empty
	// (no auth configured). Pass a nil client and assert no panic.
	if err := authenticate(nil, "host", "", "", "plain"); err != nil {
		t.Errorf("expected nil error for empty creds; got %v", err)
	}
}

// TestAuthenticateUnknownMode — bogus auth mode returns an error so
// we don't silently default to PLAIN against a server that asked for
// something else.
func TestAuthenticateUnknownMode(t *testing.T) {
	t.Parallel()
	err := authenticate(nil, "host", "u", "p", "kerberos5")
	if err == nil || !strings.Contains(err.Error(), "unknown auth mode") {
		t.Errorf("expected unknown-auth-mode error; got %v", err)
	}
}

// Sanity that the test SMTP server itself works the way we assume.
// (If this breaks, every other test breaks for the same reason.)
func TestHarnessSmokeViaStdlibClient(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	addr := fmt.Sprintf("%s:%d", host, port)
	if err := stdsmtp.SendMail(addr, nil, "from@x", []string{"to@y"},
		[]byte("Subject: hi\r\n\r\nbody\r\n"),
	); err != nil {
		t.Fatal(err)
	}
	if got := be.firstTx(t); got.from != "from@x" {
		t.Errorf("envelope from = %q, want from@x", got.from)
	}
}

// silence unused-helper lint
var _ = parsePort
var _ = errors.New
