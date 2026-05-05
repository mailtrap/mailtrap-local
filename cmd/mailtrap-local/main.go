// Command mailtrap-local is the single binary that runs the SMTP
// listener, the HTTP+JSON API, and the embedded React SPA. Bound to
// loopback by design — auth, TLS, and rate limiting are intentionally
// out of scope.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/api"
	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/jobs"
	"github.com/mailtrap/mailtrap-local/internal/live"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/smtpd"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
)

// Build-time identity. Populated via `-ldflags "-X main.version=… -X main.commit=… -X main.buildDate=…"`
// by goreleaser (see .goreleaser.yaml). Defaults are useful for `go run`
// + bare `go build` so dev builds carry an obvious sentinel.
var (
	version   = "dev"
	commit    = "none"
	buildDate = "unknown"
)

//go:embed openapi.yaml
var openAPISpec []byte

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

	var (
		smtpListen = flag.String("smtp-listen", "127.0.0.1:3535",
			"SMTP listen address(es), comma-separated host:port. Default binds both IPv4 and IPv6 loopback.")
		httpListen = flag.String("http-listen", "127.0.0.1:3550",
			"HTTP listen address.")
		dbPath = flag.String("db", defaultDBPath(),
			"SQLite database file. Empty/`:memory:` for an ephemeral DB.")
		showVersion = flag.Bool("version", false,
			"Print version and exit.")
	)
	flag.Parse()

	if *showVersion {
		fmt.Printf("mailtrap-local %s (commit %s, built %s, %s/%s)\n",
			version, commit, buildDate, runtime.GOOS, runtime.GOARCH)
		return
	}

	log.Printf("mailtrap-local %s (commit %s)", version, commit)

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

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
			inline, _ := st.LoadInline(context.Background(), m.ID)
			atts, _ := st.LoadAttachments(context.Background(), m.ID)
			return json.Marshal(api.WireDetail(m, inline, atts))
		},
	}

	frontendFS, err := fs.Sub(distEmbed, "dist")
	if err != nil {
		log.Fatalf("embed dist: %v", err)
	}

	apiSrv := &api.Server{
		Store:    st,
		Hub:      hub,
		Relay:    relayCl,
		Webhook:  webhookCl,
		Frontend: frontendFS,
		OpenAPI:  openAPISpec,
		OnIngest: dispatcher.AfterIngest,
	}

	srv := &smtpd.Server{
		Listen: *smtpListen, Store: st,
		AfterInsert: dispatcher.AfterIngest,
	}
	if err := srv.Start(); err != nil {
		log.Fatalf("start smtpd: %v", err)
	}
	defer srv.Close()

	httpSrv := &http.Server{
		Addr:              *httpListen,
		Handler:           apiSrv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("HTTP listening on %s", *httpListen)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()
	log.Printf("SMTP listening on %v", srv.Addrs())
	log.Printf("DB: %s", *dbPath)
	if p := cfg.Get().SourcePath; p != "" {
		log.Printf("Config: %s", p)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("shutting down...")
	_ = httpSrv.Close()
	_ = srv.Close()
}

// broadcastCreated builds a MessageSummary for the broadcasted JSON
// frame. Lives here (not jobs/) because it crosses the jobs ↔ api
// package line.
func broadcastCreated(hub *live.Hub, st *store.Store, msgID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	m, err := st.Get(ctx, msgID)
	if err != nil {
		return
	}
	// Attachment count — same shape the list endpoint emits.
	counts, _ := st.AttachmentsCount(ctx, []string{m.ID})
	summary := api.WireSummary(m, counts[m.ID])
	raw, err := json.Marshal(summary)
	if err != nil {
		return
	}
	hub.BroadcastCreated(raw)
}

func defaultDBPath() string {
	return filepath.Join("data", "mailtrap-local.sqlite3")
}
