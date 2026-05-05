package main

import (
	"bytes"
	"io"
	"net"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/emersion/go-smtp"
)

func TestParseSendmailArgs(t *testing.T) {
	cases := []struct {
		name string
		argv []string
		want sendmailArgs
	}{
		{
			name: "bare positional recipients",
			argv: []string{"a@example.com", "b@example.com"},
			want: sendmailArgs{recipients: []string{"a@example.com", "b@example.com"}},
		},
		{
			name: "-t alone",
			argv: []string{"-t"},
			want: sendmailArgs{readRecipientsFromHeaders: true},
		},
		{
			name: "-t with -i and -oi",
			argv: []string{"-i", "-oi", "-t"},
			want: sendmailArgs{readRecipientsFromHeaders: true},
		},
		{
			name: "-f glued",
			argv: []string{"-fme@example.com", "-t"},
			want: sendmailArgs{readRecipientsFromHeaders: true, sender: "me@example.com"},
		},
		{
			name: "-f separate",
			argv: []string{"-f", "me@example.com", "-t"},
			want: sendmailArgs{readRecipientsFromHeaders: true, sender: "me@example.com"},
		},
		{
			name: "-f with positional",
			argv: []string{"-f", "me@example.com", "you@example.com"},
			want: sendmailArgs{sender: "me@example.com", recipients: []string{"you@example.com"}},
		},
		{
			name: "accept-and-ignore -F -N -O",
			argv: []string{"-F", "Full Name", "-Nfailure", "-O", "DeliveryMode=b", "you@example.com"},
			want: sendmailArgs{recipients: []string{"you@example.com"}},
		},
		{
			name: "verbose",
			argv: []string{"-v", "-t"},
			want: sendmailArgs{readRecipientsFromHeaders: true, verbose: true},
		},
		{
			name: "-- terminator",
			argv: []string{"-t", "--", "-not-a-flag@example.com"},
			want: sendmailArgs{readRecipientsFromHeaders: true, recipients: []string{"-not-a-flag@example.com"}},
		},
		{
			name: "PHP-typical: -t -i",
			argv: []string{"-t", "-i"},
			want: sendmailArgs{readRecipientsFromHeaders: true},
		},
		{
			name: "unknown flag tolerated",
			argv: []string{"-Z", "you@example.com"},
			want: sendmailArgs{recipients: []string{"you@example.com"}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseSendmailArgs(tc.argv)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestParseSendmailArgsRejectsUnsupportedModes(t *testing.T) {
	for _, mode := range []string{"-bs", "-bp", "-bd", "-bv", "-bt"} {
		t.Run(mode, func(t *testing.T) {
			_, err := parseSendmailArgs([]string{mode})
			if err == nil {
				t.Fatalf("expected error for %s, got nil", mode)
			}
		})
	}
}

func TestNormalizeCRLF(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"line1\nline2\n", "line1\r\nline2\r\n"},
		{"line1\r\nline2\r\n", "line1\r\nline2\r\n"},
		{"mixed\r\nlf\nonly\n", "mixed\r\nlf\r\nonly\r\n"},
		{"", ""},
	}
	for _, tc := range cases {
		got := string(normalizeCRLF([]byte(tc.in)))
		if got != tc.want {
			t.Fatalf("normalizeCRLF(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestSendmailDispatch(t *testing.T) {
	cases := []struct {
		name     string
		osArgs   []string
		want     bool
		wantArgv []string
	}{
		{"daemon mode (default name)", []string{"mailtrap-local", "--smtp-listen", "127.0.0.1:3535"}, false, nil},
		{"sendmail by basename", []string{"/usr/local/bin/sendmail", "-t", "-i"}, true, []string{"-t", "-i"}},
		{"mailtrap-sendmail by basename", []string{"/opt/homebrew/bin/mailtrap-sendmail", "-t"}, true, []string{"-t"}},
		{"explicit subcommand", []string{"mailtrap-local", "sendmail", "-t", "you@example.com"}, true, []string{"-t", "you@example.com"}},
		{"basename with .exe suffix", []string{"sendmail.exe", "-t"}, true, []string{"-t"}},
		{"empty argv", []string{}, false, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, argv := sendmailDispatch(tc.osArgs)
			if got != tc.want {
				t.Fatalf("ok = %v, want %v", got, tc.want)
			}
			if got && !reflect.DeepEqual(argv, tc.wantArgv) {
				t.Fatalf("argv = %v, want %v", argv, tc.wantArgv)
			}
		})
	}
}

// captureBackend records the first message it receives.
type captureBackend struct {
	mu       sync.Mutex
	from     string
	to       []string
	data     []byte
	received chan struct{}
}

func (b *captureBackend) NewSession(_ *smtp.Conn) (smtp.Session, error) {
	return &captureSession{b: b}, nil
}

type captureSession struct {
	b    *captureBackend
	from string
	to   []string
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
	s.b.mu.Lock()
	s.b.from = s.from
	s.b.to = append([]string{}, s.to...)
	s.b.data = raw
	s.b.mu.Unlock()
	close(s.b.received)
	return nil
}
func (s *captureSession) Reset()        { s.from = ""; s.to = nil }
func (s *captureSession) Logout() error { return nil }

// startCaptureSMTP runs an in-process SMTP listener on a random loopback
// port and returns its address plus the capture backend. The listener is
// torn down via t.Cleanup.
func startCaptureSMTP(t *testing.T) (string, *captureBackend) {
	t.Helper()
	be := &captureBackend{received: make(chan struct{})}
	server := smtp.NewServer(be)
	server.Domain = "test"
	server.AllowInsecureAuth = true
	server.ReadTimeout = 5 * time.Second
	server.WriteTimeout = 5 * time.Second

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server.Addr = l.Addr().String()
	go func() { _ = server.Serve(l) }()
	t.Cleanup(func() {
		_ = server.Close()
		_ = l.Close()
	})
	return l.Addr().String(), be
}

func TestSendmailEndToEndDashT(t *testing.T) {
	addr, be := startCaptureSMTP(t)

	const msg = "From: Sender <a@example.com>\r\n" +
		"To: b@example.com\r\n" +
		"Cc: c@example.com, d@example.com\r\n" +
		"Subject: hi\r\n" +
		"\r\n" +
		"body line\r\n"

	var stderr bytes.Buffer
	code := sendmailMain(
		sendmailConfig{smtpAddr: addr, maxBytes: 1 << 20},
		[]string{"-t", "-i"},
		strings.NewReader(msg),
		&stderr,
	)
	if code != 0 {
		t.Fatalf("exit code %d, stderr=%q", code, stderr.String())
	}

	select {
	case <-be.received:
	case <-time.After(2 * time.Second):
		t.Fatal("listener did not receive message")
	}
	be.mu.Lock()
	defer be.mu.Unlock()
	if be.from != "a@example.com" {
		t.Errorf("envelope from = %q, want a@example.com", be.from)
	}
	wantTo := []string{"b@example.com", "c@example.com", "d@example.com"}
	if !reflect.DeepEqual(be.to, wantTo) {
		t.Errorf("envelope to = %v, want %v", be.to, wantTo)
	}
	if !bytes.Contains(be.data, []byte("Subject: hi")) {
		t.Errorf("DATA missing Subject header; got: %q", be.data)
	}
}

func TestSendmailEndToEndPositionalRecipientsAndDashF(t *testing.T) {
	addr, be := startCaptureSMTP(t)

	// No To/Cc headers — recipients given on argv, sender via -f.
	const msg = "Subject: ping\r\n" +
		"\r\n" +
		"hello\r\n"

	var stderr bytes.Buffer
	code := sendmailMain(
		sendmailConfig{smtpAddr: addr, maxBytes: 1 << 20},
		[]string{"-f", "ops@example.com", "rcpt@example.com"},
		strings.NewReader(msg),
		&stderr,
	)
	if code != 0 {
		t.Fatalf("exit code %d, stderr=%q", code, stderr.String())
	}
	select {
	case <-be.received:
	case <-time.After(2 * time.Second):
		t.Fatal("listener did not receive message")
	}
	be.mu.Lock()
	defer be.mu.Unlock()
	if be.from != "ops@example.com" {
		t.Errorf("envelope from = %q, want ops@example.com", be.from)
	}
	if !reflect.DeepEqual(be.to, []string{"rcpt@example.com"}) {
		t.Errorf("envelope to = %v, want [rcpt@example.com]", be.to)
	}
}

func TestSendmailLFOnlyInputIsNormalized(t *testing.T) {
	addr, be := startCaptureSMTP(t)

	// PHP / cron-style LF-only input.
	msg := "From: a@example.com\nTo: b@example.com\nSubject: lf\n\nbody\n"

	var stderr bytes.Buffer
	code := sendmailMain(
		sendmailConfig{smtpAddr: addr, maxBytes: 1 << 20},
		[]string{"-t"},
		strings.NewReader(msg),
		&stderr,
	)
	if code != 0 {
		t.Fatalf("exit code %d, stderr=%q", code, stderr.String())
	}
	select {
	case <-be.received:
	case <-time.After(2 * time.Second):
		t.Fatal("listener did not receive message")
	}
	be.mu.Lock()
	defer be.mu.Unlock()
	if !bytes.Contains(be.data, []byte("Subject: lf\r\n")) {
		t.Errorf("expected CRLF-terminated headers in DATA, got: %q", be.data)
	}
	if bytes.Contains(be.data, []byte("\r\r\n")) {
		t.Errorf("CR doubled — got bare \\r\\r\\n in DATA: %q", be.data)
	}
}

func TestSendmailEmptyStdin(t *testing.T) {
	addr, _ := startCaptureSMTP(t)
	var stderr bytes.Buffer
	code := sendmailMain(
		sendmailConfig{smtpAddr: addr, maxBytes: 1 << 20},
		[]string{"-t"},
		strings.NewReader(""),
		&stderr,
	)
	if code != exitDataErr {
		t.Fatalf("exit code %d, want %d", code, exitDataErr)
	}
	if !strings.Contains(stderr.String(), "empty message") {
		t.Errorf("expected 'empty message' in stderr, got: %q", stderr.String())
	}
}

func TestSendmailNoRecipients(t *testing.T) {
	addr, _ := startCaptureSMTP(t)
	const msg = "Subject: orphan\r\n\r\nno headers, no argv\r\n"
	var stderr bytes.Buffer
	code := sendmailMain(
		sendmailConfig{smtpAddr: addr, maxBytes: 1 << 20},
		[]string{}, // no -t, no positional
		strings.NewReader(msg),
		&stderr,
	)
	if code != exitUsage {
		t.Fatalf("exit code %d, want %d", code, exitUsage)
	}
	if !strings.Contains(stderr.String(), "no recipients") {
		t.Errorf("expected 'no recipients' in stderr, got: %q", stderr.String())
	}
}
