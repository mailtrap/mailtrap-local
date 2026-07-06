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
	"sync"
	"testing"
	"time"

	smtp "github.com/emersion/go-smtp"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func assertContains(t *testing.T, data, sub []byte, msg string, args ...any) {
	t.Helper()
	assert.True(t, bytes.Contains(data, sub), append([]any{msg}, args...)...)
}

func assertNotContains(t *testing.T, data, sub []byte, msg string, args ...any) {
	t.Helper()
	assert.False(t, bytes.Contains(data, sub), append([]any{msg}, args...)...)
}

// ---------------------------------------------------------------------
// Test SMTP harness — emersion/go-smtp listening on a random loopback
// port. Records every transaction so tests can assert envelope sender,
// recipients, and DATA bytes.
// ---------------------------------------------------------------------

type captureBackend struct {
	mu sync.Mutex
	tx []capturedTx
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
func startServer(t *testing.T) (string, int, *captureBackend) {
	t.Helper()
	be := &captureBackend{}
	server := smtp.NewServer(be)
	server.Domain = "test"
	server.AllowInsecureAuth = true
	server.ReadTimeout = 5 * time.Second
	server.WriteTimeout = 5 * time.Second

	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go func() { _ = server.Serve(l) }()
	t.Cleanup(func() {
		_ = server.Close()
		_ = l.Close()
	})
	addr, ok := l.Addr().(*net.TCPAddr)
	require.True(t, ok)
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
	require.NotEmpty(t, b.tx)
	return b.tx[0]
}

// ---------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------

func TestProbeSuccess(t *testing.T) {
	t.Parallel()
	host, port, _ := startServer(t)
	c := &Client{}
	assert.NoError(t, c.Probe(context.Background(), host, port, "", "", "", "off"))
}

func TestProbeFailsOnClosedPort(t *testing.T) {
	t.Parallel()
	c := &Client{}
	err := c.Probe(context.Background(), "127.0.0.1", 1, "", "", "", "off")
	assert.Error(t, err)
}

// Explicit tls=starttls must fail closed when the server doesn't
// advertise STARTTLS, instead of silently continuing in cleartext. The
// test server has no TLS configured, so it advertises no STARTTLS.
func TestProbeStartTLSRequiredFailsWhenUnsupported(t *testing.T) {
	t.Parallel()
	host, port, _ := startServer(t)
	c := &Client{}
	err := c.Probe(context.Background(), host, port, "", "", "", "starttls")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "STARTTLS")
}

// tls=auto stays best-effort: no STARTTLS advertised → continue.
func TestProbeAutoFallsBackWhenStartTLSUnsupported(t *testing.T) {
	t.Parallel()
	host, port, _ := startServer(t)
	c := &Client{}
	assert.NoError(t, c.Probe(context.Background(), host, port, "", "", "", "auto"))
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
	require.NoError(t, c.Forward(context.Background(), newConn(host, port), newMsg(),
		[]string{"new@y.test"}, false,
	))

	tx := be.firstTx(t)
	assert.Equal(t, "original@x.test", tx.from)
	assert.Equal(t, []string{"new@y.test"}, tx.to)
	assert.True(t, bytes.Contains(tx.data, []byte("Subject: probe")))
}

func TestForwardMultipleRecipients(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	c := &Client{}
	rcpts := []string{"a@y.test", "b@y.test", "c@y.test"}
	require.NoError(t, c.Forward(context.Background(), newConn(host, port), newMsg(), rcpts, false))
	tx := be.firstTx(t)
	require.Len(t, tx.to, 3)
	for i, r := range rcpts {
		assert.Equal(t, r, tx.to[i])
	}
}

func TestForwardRejectsEmptyRecipientList(t *testing.T) {
	t.Parallel()
	c := &Client{}
	err := c.Forward(context.Background(), &store.RelayConnection{Host: "x", Port: 25}, newMsg(), nil, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no recipients")
}

func TestForwardOverridesFromHeaderAndStashesOriginal(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	conn := newConn(host, port)
	conn.OverrideFrom = "noreply@verified.test"
	c := &Client{}
	require.NoError(t, c.Forward(context.Background(), conn, newMsg(), []string{"r@y.test"}, false))
	tx := be.firstTx(t)
	assertContains(t, tx.data, []byte("From: noreply@verified.test"),
		"From header NOT rewritten; data:\n%s", tx.data)
	assertContains(t, tx.data, []byte("X-Original-From: original@x.test"),
		"X-Original-From missing; data:\n%s", tx.data)
	// Envelope sender (MAIL FROM) is independent of From-header
	// rewriting — it follows ReturnPath if set, else the original.
	assert.Equal(t, "original@x.test", tx.from)
}

// Messages ingested via /api/v1/ingest may carry LF-only line endings.
// rewriteFromHeader must still apply the override (otherwise the
// rewrite silently no-ops and the original From: leaks through).
func TestForwardOverridesFromHeaderWithLFOnlyRaw(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	conn := newConn(host, port)
	conn.OverrideFrom = "noreply@verified.test"
	m := newMsg()
	m.Raw = []byte("From: original@x.test\nSubject: lf-only\n\nbody\n")
	c := &Client{}
	require.NoError(t, c.Forward(context.Background(), conn, m, []string{"r@y.test"}, false))
	tx := be.firstTx(t)
	assertContains(t, tx.data, []byte("From: noreply@verified.test"),
		"From header NOT rewritten on LF-only raw; data:\n%s", tx.data)
}

func TestForwardReturnPathRewritesEnvelopeSender(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	conn := newConn(host, port)
	conn.ReturnPath = "bounces@verified.test"
	c := &Client{}
	require.NoError(t, c.Forward(context.Background(), conn, newMsg(), []string{"r@y.test"}, false))
	tx := be.firstTx(t)
	assert.Equal(t, "bounces@verified.test", tx.from)
	// The DATA From: header is NOT rewritten by ReturnPath — only by
	// OverrideFrom.
	assertContains(t, tx.data, []byte("From: original@x.test"),
		"From header should remain unchanged; got:\n%s", tx.data)
}

// rewriteTo=true (manual Release) rewrites the To: header to the
// recipients so the delivered copy reads as addressed to them, while the
// envelope RCPT TO still drives delivery and the original is preserved
// under X-Original-To.
func TestForwardRewriteToRewritesHeaderAndStashesOriginal(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	c := &Client{}
	require.NoError(t, c.Forward(context.Background(), newConn(host, port), newMsg(),
		[]string{"new@y.test"}, true,
	))
	tx := be.firstTx(t)
	assert.Equal(t, []string{"new@y.test"}, tx.to)
	assert.True(t, bytes.Contains(tx.data, []byte("To: new@y.test")), "To header NOT rewritten; data:\n%s", tx.data)
	assertContains(t, tx.data, []byte("X-Original-To: dropped@x.test"),
		"X-Original-To missing; data:\n%s", tx.data)
}

// rewriteTo=false (auto-relay / default) must leave the To: header alone.
func TestForwardWithoutRewriteToPreservesHeader(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	c := &Client{}
	require.NoError(t, c.Forward(context.Background(), newConn(host, port), newMsg(),
		[]string{"new@y.test"}, false,
	))
	tx := be.firstTx(t)
	assertContains(t, tx.data, []byte("To: dropped@x.test"),
		"To header should be preserved when rewriteTo=false; data:\n%s", tx.data)
	assertNotContains(t, tx.data, []byte("X-Original-To:"),
		"X-Original-To should not be added when rewriteTo=false; data:\n%s", tx.data)
}

func TestForwardRewriteToJoinsMultipleRecipients(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	c := &Client{}
	require.NoError(t, c.Forward(context.Background(), newConn(host, port), newMsg(),
		[]string{"a@y.test", "b@y.test"}, true,
	))
	tx := be.firstTx(t)
	assertContains(t, tx.data, []byte("To: a@y.test, b@y.test"),
		"To header should list both recipients; data:\n%s", tx.data)
}

// ---------------------------------------------------------------------
// rewriteFromHeader — pure unit tests
// ---------------------------------------------------------------------

func TestRewriteFromHeaderReplacesFirstFrom(t *testing.T) {
	t.Parallel()
	in := []byte("From: orig@x\r\nTo: t@y\r\nSubject: hi\r\n\r\nbody\r\n")
	out := rewriteFromHeader(in, "new@x", "orig@x")
	assert.True(t, bytes.Contains(out, []byte("From: new@x")), "From not replaced: %s", out)
	assert.True(t, bytes.Contains(out, []byte("X-Original-From: orig@x")), "X-Original-From not added: %s", out)
	// Body preserved untouched.
	assert.True(t, bytes.HasSuffix(out, []byte("\r\nbody\r\n")), "body modified: %s", out)
}

func TestRewriteFromHeaderDoesNotStackOriginalFrom(t *testing.T) {
	t.Parallel()
	in := []byte("From: orig@x\r\n" +
		"X-Original-From: stale@x\r\n" +
		"To: t@y\r\n\r\nbody\r\n")
	out := rewriteFromHeader(in, "new@x", "orig@x")
	assert.Equal(t, 1, bytes.Count(out, []byte("X-Original-From:")),
		"X-Original-From count (must replace, not stack)\n%s", out)
	assertContains(t, out, []byte("X-Original-From: orig@x"),
		"X-Original-From should reflect orig@x, not stale@x\n%s", out)
}

func TestRewriteFromHeaderTouchesOnlyFirstFromOccurrence(t *testing.T) {
	t.Parallel()
	// Pathological: a literal "From:" line in the BODY should NOT be
	// touched. We split on "\r\n\r\n" so the body is left alone.
	in := []byte("From: orig@x\r\nSubject: re\r\n\r\nFrom: bystander@y\r\nbody\r\n")
	out := rewriteFromHeader(in, "new@x", "")
	assert.True(t, bytes.Contains(out, []byte("\r\nFrom: bystander@y\r\n")), "body 'From:' line was modified: %s", out)
	assert.True(t, bytes.HasPrefix(out, []byte("From: new@x")), "header From not replaced: %s", out)
}

func TestRewriteFromHeaderNoHeaderBodyBoundaryReturnsInput(t *testing.T) {
	t.Parallel()
	in := []byte("From: orig@x\r\n") // no \r\n\r\n
	out := rewriteFromHeader(in, "new@x", "orig@x")
	assert.Equal(t, in, out)
}

// ---------------------------------------------------------------------
// rewriteToHeader — pure unit tests
// ---------------------------------------------------------------------

func TestRewriteToHeaderReplacesAndStashesOriginal(t *testing.T) {
	t.Parallel()
	in := []byte("From: f@x\r\nTo: old@y\r\nSubject: hi\r\n\r\nbody\r\n")
	out := rewriteToHeader(in, "new@z")
	assert.True(t, bytes.Contains(out, []byte("To: new@z")), "To not replaced: %s", out)
	assert.True(t, bytes.Contains(out, []byte("X-Original-To: old@y")), "X-Original-To not added: %s", out)
	assert.True(t, bytes.HasSuffix(out, []byte("\r\nbody\r\n")), "body modified: %s", out)
}

func TestRewriteToHeaderCollapsesFoldedOriginal(t *testing.T) {
	t.Parallel()
	// A folded (multi-line) To: header — continuation lines start with
	// whitespace. All of it must be captured into X-Original-To and
	// replaced by the single new line.
	in := []byte("To: a@y,\r\n b@y,\r\n c@y\r\nSubject: hi\r\n\r\nbody\r\n")
	out := rewriteToHeader(in, "new@z")
	if bytes.Contains(out, []byte("b@y")) && !bytes.Contains(out, []byte("X-Original-To:")) {
		assert.Failf(t, "folded continuation leaked into headers", "%s", out)
	}
	assert.True(t, bytes.Contains(out, []byte("To: new@z")), "To not replaced: %s", out)
	assertContains(t, out, []byte("X-Original-To: a@y, b@y, c@y"),
		"folded original not collapsed into X-Original-To: %s", out)
	assert.True(t, bytes.Contains(out, []byte("Subject: hi")), "Subject header lost: %s", out)
}

func TestRewriteToHeaderAddsWhenAbsent(t *testing.T) {
	t.Parallel()
	in := []byte("From: f@x\r\nSubject: hi\r\n\r\nbody\r\n")
	out := rewriteToHeader(in, "new@z")
	assert.True(t, bytes.Contains(out, []byte("To: new@z")), "To header not added when absent: %s", out)
	assertNotContains(t, out, []byte("X-Original-To:"),
		"X-Original-To should not be added when no original To existed: %s", out)
}

func TestRewriteToHeaderDoesNotStackOriginal(t *testing.T) {
	t.Parallel()
	in := []byte("To: old@y\r\nX-Original-To: stale@y\r\nSubject: hi\r\n\r\nbody\r\n")
	out := rewriteToHeader(in, "new@z")
	assert.Equal(t, 1, bytes.Count(out, []byte("X-Original-To:")),
		"X-Original-To count (must replace, not stack)\n%s", out)
	assertContains(t, out, []byte("X-Original-To: old@y"),
		"X-Original-To should reflect old@y, not stale@y\n%s", out)
}

func TestRewriteToHeaderLFOnly(t *testing.T) {
	t.Parallel()
	in := []byte("From: f@x\nTo: old@y\nSubject: hi\n\nbody\n")
	out := rewriteToHeader(in, "new@z")
	assert.True(t, bytes.Contains(out, []byte("To: new@z")), "To not replaced on LF-only raw: %s", out)
	assert.True(t, bytes.Contains(out, []byte("X-Original-To: old@y")), "X-Original-To missing on LF-only raw: %s", out)
}

func TestRewriteToHeaderLeavesBodyToLineAlone(t *testing.T) {
	t.Parallel()
	in := []byte("To: old@y\r\nSubject: re\r\n\r\nTo: bystander@z\r\nbody\r\n")
	out := rewriteToHeader(in, "new@z")
	assert.True(t, bytes.Contains(out, []byte("\r\nTo: bystander@z\r\n")), "body 'To:' line was modified: %s", out)
	assert.True(t, bytes.HasPrefix(out, []byte("To: new@z")), "header To not replaced: %s", out)
}

// ---------------------------------------------------------------------
// ParseAddrs
// ---------------------------------------------------------------------

func TestParseAddrsAcceptsValidAndDropsBad(t *testing.T) {
	t.Parallel()
	in := []string{"a@x.test", "Bob <b@y.test>", "not-an-email", "", "c@z.test"}
	out := ParseAddrs(in)
	require.Len(t, out, 3)
	gotAddrs := []string{out[0].Address, out[1].Address, out[2].Address}
	want := []string{"a@x.test", "b@y.test", "c@z.test"}
	for i := range want {
		assert.Equal(t, want[i], gotAddrs[i])
	}
	assert.Equal(t, "Bob", out[1].Name)
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
	assert.NoError(t, authenticate(nil, "host", "", "", "plain"))
}

// auth mode "none" skips authentication even when credentials are
// present (e.g. an open local relay like Mailpit). Nil client is safe
// because it short-circuits before touching the connection.
func TestAuthenticateNoneModeSkipsAuth(t *testing.T) {
	t.Parallel()
	assert.NoError(t, authenticate(nil, "host", "u", "p", "none"))
}

// Sanity that the test SMTP server itself works the way we assume.
// (If this breaks, every other test breaks for the same reason.)
func TestHarnessSmokeViaStdlibClient(t *testing.T) {
	t.Parallel()
	host, port, be := startServer(t)
	addr := fmt.Sprintf("%s:%d", host, port)
	require.NoError(t, stdsmtp.SendMail(addr, nil, "from@x", []string{"to@y"},
		[]byte("Subject: hi\r\n\r\nbody\r\n"),
	))
	got := be.firstTx(t)
	assert.Equal(t, "from@x", got.from)
}

// silence unused-helper lint
var (
	_ = parsePort
	_ = errors.New
)
