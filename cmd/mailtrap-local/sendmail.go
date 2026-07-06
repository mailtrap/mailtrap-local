package main

// Sendmail-replacement entrypoint. Same binary as the SMTP daemon —
// dispatched by main() when invoked as `sendmail` / `mailtrap-sendmail`,
// or via the explicit `mailtrap-local sendmail` subcommand.
//
// Reads an RFC822 message from stdin, parses just enough to determine
// envelope sender + recipients (per sendmail's CLI conventions), and
// hands the raw bytes to the local sandbox's SMTP port. No real
// delivery happens — the sandbox captures everything for inspection.

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/mail"
	"net/smtp"
	"os"
	"path/filepath"
	"strings"
)

var (
	errBSNotSupported      = errors.New("-bs (SMTP-on-stdin mode) not supported")
	errSendmailUnsupported = errors.New("sendmail option not supported")
)

const (
	defaultSendmailMaxBytes = 50 * 1024 * 1024
	optValueNextOffset      = 2

	exitOK       = 0
	exitUsage    = 64 // EX_USAGE
	exitDataErr  = 65 // EX_DATAERR
	exitIOErr    = 74 // EX_IOERR
	exitTempFail = 75 // EX_TEMPFAIL
)

// sendmailArgs holds the parsed sendmail-compatible CLI args we act on.
type sendmailArgs struct {
	readRecipientsFromHeaders bool     // -t
	sender                    string   // -f
	recipients                []string // positional
	verbose                   bool     // -v
}

// parseSendmailArgs parses a sendmail-compatible argv. Sendmail's CLI is
// idiosyncratic: most options can be glued (-fsender) or space-separated
// (-f sender), and many accept-and-ignore values. We act on -t / -f / -v;
// other recognised options are accepted and discarded so we don't break
// callers (PHP, cron, mailx) that pass them reflexively.
func parseSendmailArgs(argv []string) (sendmailArgs, error) {
	var a sendmailArgs
	i := 0
	for i < len(argv) {
		arg := argv[i]
		switch {
		case arg == "--":
			a.recipients = append(a.recipients, argv[i+1:]...)
			return a, nil
		case arg == "-t":
			a.readRecipientsFromHeaders = true
		case arg == "-i", arg == "-oi", arg == "-bm":
			// Accept silently. We read stdin to EOF, so a lone "."
			// has no special meaning regardless of -i / -oi.
		case arg == "-v":
			a.verbose = true
		case arg == "-bs":
			return a, errBSNotSupported
		case arg == "-bp", arg == "-bd", arg == "-bv", arg == "-bt":
			return a, fmt.Errorf("%w: %s", errSendmailUnsupported, arg)
		case strings.HasPrefix(arg, "-f"):
			v, next := optValue(argv, i, "-f")
			a.sender = v
			i = next
			continue
		case len(arg) >= 2 && arg[0] == '-' && isAcceptIgnorePrefix(arg[:2]):
			// Accept and discard. Consume a separate value if needed.
			_, next := optValue(argv, i, arg[:2])
			i = next
			continue
		case strings.HasPrefix(arg, "-"):
			// Unknown flag — ignore rather than fail. Sendmail callers
			// pass a mishmash of historic flags; matching that tolerance
			// is more useful than strict rejection.
		default:
			a.recipients = append(a.recipients, arg)
		}
		i++
	}
	return a, nil
}

// isAcceptIgnorePrefix reports whether a 2-char "-X" prefix is one of the
// sendmail options we tolerate but don't act on.
func isAcceptIgnorePrefix(p string) bool {
	switch p {
	case "-F", "-N", "-R", "-V", "-O", "-o", "-X", "-A", "-q", "-C", "-h", "-L":
		return true
	}
	return false
}

// optValue returns the value for a glued or space-separated option, plus
// the index of the next unprocessed argv element.
func optValue(argv []string, i int, prefix string) (string, int) {
	arg := argv[i]
	if len(arg) > len(prefix) {
		return arg[len(prefix):], i + 1
	}
	if i+1 >= len(argv) {
		return "", i + 1
	}
	return argv[i+1], i + optValueNextOffset
}

// extractHeaderRecipients pulls envelope recipients from To/Cc/Bcc headers
// of a parsed message. Used when -t is set.
func extractHeaderRecipients(msg *mail.Message) ([]string, error) {
	var rcpts []string
	for _, h := range []string{"To", "Cc", "Bcc"} {
		v := msg.Header.Get(h)
		if v == "" {
			continue
		}
		addrs, err := mail.ParseAddressList(v)
		if err != nil {
			return nil, fmt.Errorf("parse %s header: %w", h, err)
		}
		for _, ad := range addrs {
			rcpts = append(rcpts, ad.Address)
		}
	}
	return rcpts, nil
}

// extractSender returns the first From address, or "" if missing/unparseable.
func extractSender(msg *mail.Message) string {
	v := msg.Header.Get("From")
	if v == "" {
		return ""
	}
	addrs, err := mail.ParseAddressList(v)
	if err != nil || len(addrs) == 0 {
		return ""
	}
	return addrs[0].Address
}

// normalizeCRLF converts bare LF line endings to CRLF without doubling
// existing CRLFs. PHP's mail() and many cron scripts emit LF-only output;
// SMTP requires CRLF on the wire.
func normalizeCRLF(b []byte) []byte {
	// Two-pass: collapse CRLF→LF first, then expand LF→CRLF. Cheap on the
	// short messages this binary handles; correctness > one-pass cleverness.
	out := bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n"))
	out = bytes.ReplaceAll(out, []byte("\n"), []byte("\r\n"))
	return out
}

func dedupeStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// sendmailConfig is the runtime config for sendmail mode. Kept narrow so
// the test can inject an in-process listener address.
type sendmailConfig struct {
	smtpAddr string
	maxBytes int64
}

func defaultSendmailConfig() sendmailConfig {
	return sendmailConfig{
		smtpAddr: envOr("MAILTRAP_LOCAL_SMTP_ADDR", "127.0.0.1:3535"),
		maxBytes: defaultSendmailMaxBytes,
	}
}

// sendmailMain is the sendmail-mode entrypoint. Returns a process exit
// code (0 success, sysexits-style codes on failure). It writes diagnostics
// to stderr — the caller is normally another process expecting silence on
// success and a non-zero exit + stderr text on failure.
func sendmailMain(cfg sendmailConfig, argv []string, stdin io.Reader, stderr io.Writer) int {
	a, err := parseSendmailArgs(argv)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "mailtrap-local sendmail: %v\n", err)
		return exitUsage
	}

	raw, err := io.ReadAll(io.LimitReader(stdin, cfg.maxBytes))
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "mailtrap-local sendmail: read stdin: %v\n", err)
		return exitIOErr
	}
	if len(raw) == 0 {
		_, _ = fmt.Fprintf(stderr, "mailtrap-local sendmail: empty message on stdin\n")
		return exitDataErr
	}

	// Best-effort header parse. We only hard-fail if -t was passed and we
	// can't read recipients out — otherwise unparseable headers are still
	// fine to forward, the SMTP server (and the catcher) will see the raw.
	msg, parseErr := mail.ReadMessage(bytes.NewReader(raw))

	rcpts := append([]string{}, a.recipients...)
	if a.readRecipientsFromHeaders {
		if parseErr != nil {
			_, _ = fmt.Fprintf(stderr, "mailtrap-local sendmail: -t requires parseable headers: %v\n", parseErr)
			return exitDataErr
		}
		headerRcpts, err := extractHeaderRecipients(msg)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "mailtrap-local sendmail: %v\n", err)
			return exitDataErr
		}
		rcpts = append(rcpts, headerRcpts...)
	}
	rcpts = dedupeStrings(rcpts)
	if len(rcpts) == 0 {
		_, _ = fmt.Fprintf(stderr, "mailtrap-local sendmail: no recipients (use -t or pass addresses as args)\n")
		return exitUsage
	}

	sender := a.sender
	if sender == "" && msg != nil {
		sender = extractSender(msg)
	}
	if sender == "" {
		sender = "MAILER-DAEMON@localhost"
	}

	body := normalizeCRLF(raw)
	if err := smtp.SendMail(cfg.smtpAddr, nil, sender, rcpts, body); err != nil {
		_, _ = fmt.Fprintf(stderr, "mailtrap-local sendmail: send to %s: %v\n", cfg.smtpAddr, err)
		return exitTempFail
	}
	if a.verbose {
		_, _ = fmt.Fprintf(stderr, "mailtrap-local sendmail: delivered %d byte(s) to %d recipient(s) via %s\n",
			len(body), len(rcpts), cfg.smtpAddr)
	}
	return exitOK
}

// sendmailDispatch returns (true, argv-for-sendmail) when the process was
// invoked in a way that should run sendmail mode — either via argv[0]
// basename (`sendmail` / `mailtrap-sendmail`) or via the explicit
// `mailtrap-local sendmail [...]` subcommand. Otherwise (false, nil).
func sendmailDispatch(osArgs []string) (bool, []string) {
	if len(osArgs) == 0 {
		return false, nil
	}
	exe := strings.TrimSuffix(filepath.Base(osArgs[0]), ".exe")
	if exe == "sendmail" || exe == "mailtrap-sendmail" {
		return true, osArgs[1:]
	}
	if len(osArgs) > 1 && osArgs[1] == "sendmail" {
		return true, osArgs[2:]
	}
	return false, nil
}
