// Package relay forwards messages through an upstream SMTP server.
//
// Two entry points:
//
//   - Probe        — verify reachability + auth (used by the dialog's
//     "Send test" button); doesn't actually send mail.
//   - Forward      — relay a stored RFC822 source through the upstream
//     to one or more recipients, applying optional
//     From / Return-Path overrides.
package relay

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"strings"

	"github.com/mailtrap/mailtrap-local/internal/store"
)

// Client is stateless — the SMTP connection is opened per call. All
// methods accept a context for cancellation, but the stdlib smtp client
// doesn't natively honor it; we apply it via net.Dialer.DialContext.
type Client struct{}

// Probe opens a connection, runs STARTTLS / auth as configured, and
// closes cleanly. Returns nil on success. Used by `relay_connection/test`.
func (c *Client) Probe(ctx context.Context, host string, port int, username, password, authMode, tlsMode string) error {
	conn, err := dial(ctx, host, port, tlsMode)
	if err != nil {
		return err
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("greet: %w", err)
	}
	defer client.Close()

	if err := maybeStartTLS(client, host, tlsMode); err != nil {
		return err
	}
	if err := authenticate(client, host, username, password, authMode); err != nil {
		return err
	}
	return client.Quit()
}

// Forward relays a stored message to `recipients`, mutating only the
// To: header (preserving everything else). Optional `overrideFrom` and
// `returnPath` rewrite the From header and the SMTP envelope sender.
func (c *Client) Forward(ctx context.Context, conn *store.RelayConnection,
	m *store.Message, recipients []string,
) error {
	if len(recipients) == 0 {
		return errors.New("no recipients")
	}

	body := bytes.Clone(m.Raw)
	if conn.OverrideFrom != "" {
		body = rewriteFromHeader(body, conn.OverrideFrom, m.FromAddress)
	}

	envFrom := m.FromAddress
	if conn.ReturnPath != "" {
		envFrom = conn.ReturnPath
	}

	netConn, err := dial(ctx, conn.Host, conn.Port, conn.TLS)
	if err != nil {
		return err
	}
	defer netConn.Close()

	client, err := smtp.NewClient(netConn, conn.Host)
	if err != nil {
		return fmt.Errorf("greet: %w", err)
	}
	defer client.Close()

	if err := maybeStartTLS(client, conn.Host, conn.TLS); err != nil {
		return err
	}
	if err := authenticate(client, conn.Host, conn.Username, conn.Password, conn.Auth); err != nil {
		return err
	}

	if err := client.Mail(envFrom); err != nil {
		return fmt.Errorf("MAIL FROM: %w", err)
	}
	for _, rcpt := range recipients {
		if err := client.Rcpt(rcpt); err != nil {
			return fmt.Errorf("RCPT TO %q: %w", rcpt, err)
		}
	}
	wc, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA: %w", err)
	}
	if _, err := wc.Write(body); err != nil {
		_ = wc.Close()
		return fmt.Errorf("write body: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("close DATA: %w", err)
	}
	return client.Quit()
}

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

func dial(ctx context.Context, host string, port int, tlsMode string) (net.Conn, error) {
	d := &net.Dialer{}
	addr := fmt.Sprintf("%s:%d", host, port)
	switch strings.ToLower(tlsMode) {
	case "ssl", "implicit", "always":
		// Implicit TLS (smtps, port 465) — wrap the raw conn in TLS.
		raw, err := d.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, fmt.Errorf("dial %s: %w", addr, err)
		}
		return tls.Client(raw, &tls.Config{ServerName: host}), nil
	default:
		// Plain TCP; STARTTLS is negotiated later for "auto"/"starttls".
		conn, err := d.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, fmt.Errorf("dial %s: %w", addr, err)
		}
		return conn, nil
	}
}

func maybeStartTLS(c *smtp.Client, host, tlsMode string) error {
	switch strings.ToLower(tlsMode) {
	case "auto", "starttls", "":
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return nil // server doesn't advertise it; auto = best-effort
		}
		return c.StartTLS(&tls.Config{ServerName: host})
	case "off", "never", "none":
		return nil
	case "ssl", "implicit", "always":
		// already TLS-wrapped at dial time
		return nil
	}
	return nil
}

func authenticate(c *smtp.Client, host, user, pass, mode string) error {
	if user == "" && pass == "" {
		return nil // no auth configured
	}
	switch strings.ToLower(mode) {
	case "", "plain":
		return c.Auth(smtp.PlainAuth("", user, pass, host))
	case "login":
		return c.Auth(loginAuth{user, pass})
	case "cram_md5", "cram-md5":
		return c.Auth(smtp.CRAMMD5Auth(user, pass))
	case "none":
		return nil
	}
	return fmt.Errorf("unknown auth mode: %s", mode)
}

// loginAuth implements the LOGIN SMTP auth mechanism (Microsoft-flavored,
// not part of the Go stdlib).
type loginAuth struct{ user, pass string }

func (a loginAuth) Start(_ *smtp.ServerInfo) (string, []byte, error) {
	return "LOGIN", nil, nil
}
func (a loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimSpace(string(fromServer))) {
	case "username:":
		return []byte(a.user), nil
	case "password:":
		return []byte(a.pass), nil
	}
	return nil, fmt.Errorf("unexpected challenge: %q", fromServer)
}

// rewriteFromHeader replaces the first `From:` header value with the
// new address, preserving the original under `X-Original-From`.
func rewriteFromHeader(body []byte, newFrom, originalFrom string) []byte {
	// Crude header walk — fine for our use because RFC822 has explicit
	// CRLF folding rules and we operate on well-formed mail from the
	// catcher, which always normalizes line endings.
	headerEnd := bytes.Index(body, []byte("\r\n\r\n"))
	if headerEnd < 0 {
		return body
	}
	headers := body[:headerEnd]
	rest := body[headerEnd:]

	lines := bytes.Split(headers, []byte("\r\n"))
	out := make([][]byte, 0, len(lines)+1)
	replaced := false
	for _, line := range lines {
		if !replaced && bytes.HasPrefix(bytes.ToLower(line), []byte("from:")) {
			out = append(out, []byte("From: "+newFrom))
			replaced = true
			continue
		}
		out = append(out, line)
	}
	if originalFrom != "" {
		// Drop any pre-existing X-Original-From to avoid stacking on multi-relay paths.
		filtered := make([][]byte, 0, len(out))
		for _, line := range out {
			if bytes.HasPrefix(bytes.ToLower(line), []byte("x-original-from:")) {
				continue
			}
			filtered = append(filtered, line)
		}
		out = append(filtered, []byte("X-Original-From: "+originalFrom))
	}

	var buf bytes.Buffer
	buf.Write(bytes.Join(out, []byte("\r\n")))
	buf.Write(rest)
	return buf.Bytes()
}

// ParseAddrs is a small helper for callers that have a slice of
// recipient strings: returns the parsed mailboxes (drops malformed).
func ParseAddrs(in []string) []*mail.Address {
	out := make([]*mail.Address, 0, len(in))
	for _, s := range in {
		a, err := mail.ParseAddress(s)
		if err != nil {
			continue
		}
		out = append(out, a)
	}
	return out
}
