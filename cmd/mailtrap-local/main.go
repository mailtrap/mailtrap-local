// Command mailtrap-local is the single binary that runs the SMTP
// listener, the HTTP+JSON API, and the embedded React SPA. Bound to
// loopback by design — auth, TLS, and rate limiting are intentionally
// out of scope.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/api"
	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/jobs"
	"github.com/mailtrap/mailtrap-local/internal/live"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/secrets"
	"github.com/mailtrap/mailtrap-local/internal/smtpd"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
)

// Build-time identity. Populated via `-ldflags "-X main.version=… -X main.commit=… -X main.buildDate=…"`
// by goreleaser (see .goreleaser.yaml). Defaults are useful for `go run`
// + bare `go build` so dev builds carry an obvious sentinel.
var (
	errEmptyListenAddress  = errors.New("empty listen address")
	errListenBindsAll      = errors.New("listen binds all interfaces")
	errListenNotLoopback   = errors.New("listen hostname is not loopback")
	errListenIPNotLoopback = errors.New("listen address is not loopback")

	version   = "dev"
	commit    = "none"
	buildDate = "unknown"
)

//go:embed openapi.yaml
var openAPISpec []byte

const (
	shutdownTimeout  = 10 * time.Second
	broadcastTimeout = 5 * time.Second
)

// distFS holds the built React SPA. `scripts/build.sh` populates dist/
// from frontend/dist before `go build`. The `all:` prefix is required
// so files starting with `_` or `.` (e.g. Vite asset hashes) are kept.
//
//go:embed all:dist
var distEmbed embed.FS

func main() {
	// Sendmail mode short-circuit. When invoked as `sendmail`,
	// `mailtrap-sendmail`, or `mailtrap-local sendmail …`, behave like
	// /usr/sbin/sendmail and exit. Daemon flags below are not parsed in
	// that path.
	if ok, argv := sendmailDispatch(os.Args); ok {
		os.Exit(sendmailMain(defaultSendmailConfig(), argv, os.Stdin, os.Stderr))
	}

	// Structured logging. TextHandler is logfmt-ish (`time=... level=...
	// msg="..." key=value`) — readable in a terminal and parseable by
	// any standard log shipper. Level INFO matches the previous log.*
	// default; promote to DEBUG via --log-level=debug if you need it.
	logLevel := new(slog.LevelVar)
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: logLevel,
	})))

	var (
		smtpListen = flag.String("smtp-listen", "127.0.0.1:3535",
			"SMTP listen address(es), comma-separated host:port. Default binds both IPv4 and IPv6 loopback.")
		httpListen = flag.String("http-listen", "127.0.0.1:3550",
			"HTTP listen address.")
		dbPath = flag.String("db", defaultDBPath(),
			"SQLite database file. Empty/`:memory:` for an ephemeral DB.")
		showVersion = flag.Bool("version", false,
			"Print version and exit.")
		unsafeNonLoopback = flag.Bool("unsafe-non-loopback", false,
			"Allow binding to non-loopback addresses. The server has no auth/TLS/rate-limiting; "+
				"only use on trusted networks.")
		logLevelFlag = flag.String("log-level", "info",
			"Log level: debug, info, warn, error.")
	)
	flag.Parse()
	switch strings.ToLower(*logLevelFlag) {
	case "debug":
		logLevel.Set(slog.LevelDebug)
	case "warn":
		logLevel.Set(slog.LevelWarn)
	case "error":
		logLevel.Set(slog.LevelError)
	default:
		logLevel.Set(slog.LevelInfo)
	}

	if *showVersion {
		fmt.Printf("mailtrap-local %s (commit %s, built %s, %s/%s)\n",
			version, commit, buildDate, runtime.GOOS, runtime.GOARCH)
		return
	}

	// Refuse non-loopback binds without explicit opt-in. The server has
	// no authentication, no TLS, and CORS is wide open — appropriate
	// for a single-developer localhost tool, dangerous on a shared
	// network. The flag exists as an escape hatch (e.g. container
	// networking, intentional LAN access) but must be set deliberately.
	if !*unsafeNonLoopback {
		for _, addr := range append(strings.Split(*smtpListen, ","), *httpListen) {
			if err := requireLoopback(addr); err != nil {
				fatal("listen check", err, "hint", "pass --unsafe-non-loopback to override; the server has no auth or TLS")
			}
		}
	}

	slog.Info("mailtrap-local starting",
		slog.String("version", version), slog.String("commit", commit))

	st, err := store.Open(*dbPath)
	if err != nil {
		fatal("open store", err)
	}
	defer func() { _ = st.Close() }()

	// At-rest encryption for the cloud API token / relay password /
	// webhook secret. Key file auto-generated on first use; override
	// path with $MAILTRAP_LOCAL_SECRET_KEY_FILE. Failure here is fatal
	// because every subsequent connection-CRUD call would fail.
	box, err := secrets.FromDefaultKeyFile()
	if err != nil {
		fatal("init secret key", err)
	}
	st.SetSecrets(box)
	if p, _ := secrets.DefaultKeyPath(); p != "" {
		slog.Info("secret key", slog.String("path", p))
	}

	hub := live.NewHub()
	cfg := config.NewLoader()
	relayCl := &relay.Client{}
	webhookCl := webhook.NewClient()

	dispatcher := &jobs.Dispatcher{
		Store:   st,
		Relay:   relayCl,
		Webhook: webhookCl,
		Config:  cfg,
		BroadcastCreated: func(msgID string) {
			broadcastCreated(hub, st, msgID)
		},
		BroadcastDestroyed: func(msgID string) {
			hub.BroadcastDestroyed(msgID)
		},
		// Webhook payload mirrors GET /message/:id (full detail incl.
		// inline + attachment metadata) so receivers can target either
		// the live POST or the REST endpoint with the same parser.
		SerializeSummary: func(m *store.Message) ([]byte, error) {
			ctx := context.Background()
			inline, err := st.LoadInline(ctx, m.ID)
			if err != nil {
				slog.Warn("webhook serialize: load inline",
					slog.String("msg_id", m.ID), slog.Any("err", err))
			}
			atts, err2 := st.LoadAttachments(ctx, m.ID)
			if err2 != nil {
				slog.Warn("webhook serialize: load attachments",
					slog.String("msg_id", m.ID), slog.Any("err", err2))
			}
			return json.Marshal(api.WireDetail(m, inline, atts))
		},
	}
	dispatcher.Start()

	frontendFS, err := fs.Sub(distEmbed, "dist")
	if err != nil {
		fatal("embed dist", err)
	}

	apiSrv := &api.Server{
		Store:    st,
		Hub:      hub,
		Relay:    relayCl,
		Webhook:  webhookCl,
		Config:   cfg,
		Frontend: frontendFS,
		OpenAPI:  openAPISpec,
		OnIngest: dispatcher.AfterIngest,
	}

	srv := &smtpd.Server{
		Listen: *smtpListen, Store: st,
		AfterInsert: dispatcher.AfterIngest,
	}
	if err := srv.Start(); err != nil {
		fatal("start smtpd", err)
	}

	httpSrv := &http.Server{
		Addr:              *httpListen,
		Handler:           apiSrv.Router(),
		ReadHeaderTimeout: shutdownTimeout,
	}
	go func() {
		slog.Info("HTTP listening", slog.String("addr", *httpListen))
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("http", err)
		}
	}()
	slog.Info("SMTP listening", slog.Any("addrs", srv.Addrs()))
	slog.Info("DB", slog.String("path", *dbPath))
	if p := cfg.Get().SourcePath; p != "" {
		slog.Info("Config", slog.String("path", p))
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	slog.Info("shutting down")

	// Graceful shutdown order, bounded by a single 10s deadline:
	//   1. Stop accepting new SMTP + HTTP connections (so no further
	//      AfterIngest goroutines spawn).
	//   2. Drain in-flight HTTP requests via Shutdown.
	//   3. Cancel + wait for dispatcher background goroutines (cloud
	//      mirror, relay mirror, webhook delivery, retention). When
	//      the deadline expires, Shutdown returns an error and the
	//      remaining goroutines are abandoned — the process exits.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	srv.Close()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		slog.Warn("http shutdown", slog.Any("err", err))
	}
	if err := dispatcher.Shutdown(shutdownCtx); err != nil {
		slog.Warn("dispatcher shutdown — some side-effects abandoned",
			slog.Any("err", err))
	}
}

// fatal logs at ERROR with the provided message+err pair (plus any
// extra k/v attributes), then os.Exit(1). slog has no built-in
// equivalent of log.Fatalf, hence the helper.
func fatal(msg string, err error, kv ...any) {
	attrs := make([]any, 0, 1+len(kv))
	attrs = append(attrs, slog.Any("err", err))
	attrs = append(attrs, kv...)
	slog.Error(msg, attrs...)
	os.Exit(1)
}

// broadcastCreated builds a MessageSummary for the broadcasted JSON
// frame. Lives here (not jobs/) because it crosses the jobs ↔ api
// package line.
func broadcastCreated(hub *live.Hub, st *store.Store, msgID string) {
	ctx, cancel := context.WithTimeout(context.Background(), broadcastTimeout)
	defer cancel()
	m, err := st.Get(ctx, msgID)
	if err != nil {
		slog.Warn("live broadcast: load message",
			slog.String("msg_id", msgID), slog.Any("err", err))
		return
	}
	// Attachment count — same shape the list endpoint emits.
	counts, err := st.AttachmentsCount(ctx, []string{m.ID})
	if err != nil {
		slog.Warn("live broadcast: count attachments",
			slog.String("msg_id", msgID), slog.Any("err", err))
		return
	}
	summary := api.WireSummary(m, counts[m.ID])
	raw, err := json.Marshal(summary)
	if err != nil {
		slog.Warn("live broadcast: marshal summary",
			slog.String("msg_id", msgID), slog.Any("err", err))
		return
	}
	hub.BroadcastCreated(raw)
}

func defaultDBPath() string {
	return filepath.Join("data", "mailtrap-local.sqlite3")
}

// requireLoopback validates a `host:port` listen string and returns
// an error if the host isn't a loopback address. Accepts: "127.x.x.x",
// "::1", "localhost", and the literal forms `[::1]:port` / "0.0.0.0"
// is explicitly rejected since it binds to all interfaces.
func requireLoopback(addr string) error {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return errEmptyListenAddress
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("listen %q: %w", addr, err)
	}
	if host == "" {
		// e.g. ":3535" — Go binds all interfaces; refuse.
		return fmt.Errorf("%w: %q", errListenBindsAll, addr)
	}
	if host == "localhost" {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		// A hostname that's not "localhost". We don't resolve here —
		// the user should pass an explicit IP they trust.
		return fmt.Errorf("%w: %q (use 127.0.0.1, ::1, or localhost)", errListenNotLoopback, addr)
	}
	if !ip.IsLoopback() {
		return fmt.Errorf("%w: %q: %s", errListenIPNotLoopback, addr, ip)
	}
	return nil
}
