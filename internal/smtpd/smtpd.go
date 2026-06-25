// Package smtpd is the in-process SMTP listener. Receives RFC822 from
// any local sender, parses it with enmime, and hands the structured
// payload to the store.
//
// Co-housed with the HTTP API in the same binary — no JSON-over-HTTP
// hop between SMTP ingest and persistence.
package smtpd

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/mail"
	"strings"
	"time"

	"github.com/emersion/go-smtp"
	"github.com/jhillyerd/enmime/v2"
	"github.com/mailtrap/mailtrap-local/internal/store"
)

// Server wraps the emersion/go-smtp listener with our backend +
// metadata. Caller drives the lifecycle via Start / Close.
var errEmptyDataBody = errors.New("empty DATA body")

const (
	defaultMaxMessageBytes = 25 * 1024 * 1024
	defaultReadTimeout     = 5 * time.Minute
	maxSnippetLen          = 250
)

type Server struct {
	// Listen is the bind address; default "127.0.0.1:3535". Comma-
	// separated host:port pairs spin up multiple listeners (used to
	// bind both 127.0.0.1 and ::1 so clients that resolve "localhost"
	// to ::1 — Node 17+, modern macOS — reach us without an explicit
	// 127.0.0.1).
	Listen string

	// MaxMessageBytes caps a single DATA body. Default 25 MB.
	MaxMessageBytes int64

	Store *store.Store

	// AfterInsert fires after a successful SMTP-driven Insert so the
	// outer process can dispatch background jobs / live broadcasts.
	// Not called when Insert fails.
	AfterInsert func(msgID string)

	server    *smtp.Server
	listeners []net.Listener
}

// Start binds + serves. Non-blocking — runs each listener in its own
// goroutine. Call Close to stop.
func (s *Server) Start() error {
	if s.Listen == "" {
		s.Listen = "127.0.0.1:3535"
	}
	if s.MaxMessageBytes == 0 {
		s.MaxMessageBytes = defaultMaxMessageBytes
	}

	be := &backend{store: s.Store, afterInsert: s.AfterInsert}
	srv := smtp.NewServer(be)
	srv.Domain = "mailtrap-local"
	srv.ReadTimeout = defaultReadTimeout
	srv.WriteTimeout = 1 * time.Minute
	srv.MaxMessageBytes = s.MaxMessageBytes
	srv.MaxRecipients = 100
	srv.AllowInsecureAuth = true
	s.server = srv

	addrs := expandListenAddrs(s.Listen)
	for _, addr := range addrs {
		l, err := net.Listen("tcp", addr)
		if err != nil {
			s.Close() // close any listeners we already opened
			return fmt.Errorf("listen %s: %w", addr, err)
		}
		s.listeners = append(s.listeners, l)
		go func(l net.Listener) {
			// smtp.Server.Serve returns net.ErrClosed on Close — ignore.
			if err := srv.Serve(l); err != nil && !errors.Is(err, net.ErrClosed) {
				slog.Warn("smtpd serve failed",
					slog.String("addr", l.Addr().String()),
					slog.Any("err", err))
			}
		}(l)
	}
	srv.Addr = addrs[0]
	return nil
}

// Addrs returns the TCP addresses the server is listening on (after
// Start). Useful for tests + boot logs.
func (s *Server) Addrs() []string {
	out := make([]string, 0, len(s.listeners))
	for _, l := range s.listeners {
		out = append(out, l.Addr().String())
	}
	return out
}

// Close stops the server and closes all listeners. Safe to call
// multiple times.
func (s *Server) Close() {
	if s.server != nil {
		_ = s.server.Close()
	}
	for _, l := range s.listeners {
		_ = l.Close()
	}
	s.listeners = nil
}

// ---------------------------------------------------------------------
// emersion/go-smtp backend
// ---------------------------------------------------------------------

type backend struct {
	store       *store.Store
	afterInsert func(string)
}

func (b *backend) NewSession(_ *smtp.Conn) (smtp.Session, error) {
	return &session{store: b.store, afterInsert: b.afterInsert}, nil
}

type session struct {
	store       *store.Store
	afterInsert func(string)
	from        string
	to          []string
}

func (s *session) Mail(from string, _ *smtp.MailOptions) error {
	s.from = from
	return nil
}

func (s *session) Rcpt(to string, _ *smtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}

func (s *session) Data(r io.Reader) error {
	raw, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("read data: %w", err)
	}
	// Reject empty/whitespace-only DATA bodies — clients that close
	// DATA without writing any content still send the SMTP terminator
	// "\r\n.\r\n", which the server strips and hands us as a couple
	// of CRLFs. Without this guard those would land as ghost rows
	// the UI can't render.
	if len(bytes.TrimSpace(raw)) == 0 {
		return errEmptyDataBody
	}
	env, err := enmime.ReadEnvelope(bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("parse envelope: %w", err)
	}

	payload := buildPayload(env, raw, s.from, s.to)
	id, err := s.store.Insert(context.Background(), payload)
	if err != nil {
		return fmt.Errorf("persist: %w", err)
	}
	if s.afterInsert != nil {
		s.afterInsert(id)
	}
	return nil
}

func (s *session) Reset()        { s.from = ""; s.to = nil }
func (s *session) Logout() error { return nil }

// ---------------------------------------------------------------------
// Envelope → IngestPayload
// ---------------------------------------------------------------------

func buildPayload(env *enmime.Envelope, raw []byte, smtpFrom string, smtpTo []string) *store.IngestPayload {
	var fromAddr *store.Address
	if fromList, _ := env.AddressList("From"); len(fromList) > 0 {
		fromAddr = &store.Address{Name: fromList[0].Name, Address: fromList[0].Address}
	}
	toList, _ := env.AddressList("To")
	ccList, _ := env.AddressList("Cc")
	bccList, _ := env.AddressList("Bcc")
	replyToList, _ := env.AddressList("Reply-To")

	dateStr := ""
	if t, err := mail.ParseDate(env.GetHeader("Date")); err == nil {
		dateStr = t.UTC().Format(time.RFC3339Nano)
	}

	snippet := env.Text
	if len(snippet) > maxSnippetLen {
		snippet = snippet[:maxSnippetLen]
	}

	return &store.IngestPayload{
		SMTPFrom:    smtpFrom,
		SMTPTo:      smtpTo,
		MessageID:   env.GetHeader("Message-Id"),
		From:        fromAddr,
		To:          toAddrs(toList),
		Cc:          toAddrs(ccList),
		Bcc:         toAddrs(bccList),
		ReplyTo:     toAddrs(replyToList),
		ReturnPath:  env.GetHeader("Return-Path"),
		Subject:     env.GetHeader("Subject"),
		Date:        dateStr,
		Category:    extractCategory(env),
		Text:        env.Text,
		HTML:        env.HTML,
		Raw:         raw,
		Size:        len(raw),
		Snippet:     snippet,
		Inlines:     toParts(env.Inlines),
		Attachments: toParts(env.Attachments),
	}
}

// extractCategory reads the message category at ingest, preferring the
// Mailtrap-cloud SMTP convention header (X-MT-Category) over a plain
// Category header. Both are accepted so a developer who labels mail
// one way locally doesn't have to retag when switching to cloud.
func extractCategory(env *enmime.Envelope) string {
	for _, h := range []string{"X-MT-Category", "Category"} {
		if v := strings.TrimSpace(env.GetHeader(h)); v != "" {
			return v
		}
	}
	return ""
}

func toAddrs(as []*mail.Address) []store.Address {
	out := make([]store.Address, 0, len(as))
	for _, a := range as {
		if a != nil {
			out = append(out, store.Address{Name: a.Name, Address: a.Address})
		}
	}
	return out
}

func toParts(ps []*enmime.Part) []store.PartIn {
	out := make([]store.PartIn, 0, len(ps))
	for _, p := range ps {
		out = append(out, store.PartIn{
			PartID:      p.PartID,
			Filename:    p.FileName,
			ContentType: p.ContentType,
			ContentID:   p.ContentID,
			Size:        len(p.Content),
			Content:     p.Content,
		})
	}
	return out
}

// expandListenAddrs lets a single "127.0.0.1:3535" or "localhost:3535"
// expand into both IPv4 and IPv6 loopback so clients that prefer ::1
// (Node 17+) reach us.
func expandListenAddrs(listen string) []string {
	addrs := strings.Split(listen, ",")
	for i, a := range addrs {
		addrs[i] = strings.TrimSpace(a)
	}
	if len(addrs) == 1 {
		host, port, err := net.SplitHostPort(addrs[0])
		if err == nil && (host == "127.0.0.1" || host == "localhost") {
			return []string{
				net.JoinHostPort("127.0.0.1", port),
				net.JoinHostPort("::1", port),
			}
		}
	}
	return addrs
}
