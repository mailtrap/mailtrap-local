// Package jobs runs the side effects that fire on every newly captured
// message: cloud mirror, relay mirror, webhook delivery. Plus
// retention enforcement.
//
// Implemented as goroutines fed off a buffered channel. Best-effort —
// failures are logged but never block ingestion.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/cloud"
	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
)

// Dispatcher fans out post-ingest work to background goroutines.
//
// Lifecycle: optional. Call Start() to make the dispatcher
// shutdown-aware; Shutdown(ctx) then cancels in-flight work and waits
// for goroutines to return. Without Start, AfterIngest still works —
// goroutines run with a background parent context and Shutdown is a
// no-op. Tests use the unstarted form; main.go calls Start.
type Dispatcher struct {
	Store   *store.Store
	Relay   *relay.Client
	Webhook *webhook.Client
	Config  *config.Loader

	// Live broadcast hooks — caller injects closures that publish to
	// the WS hub. Decoupled here to avoid an import cycle between
	// jobs ↔ live ↔ api.
	BroadcastCreated   func(msgID string)
	BroadcastDestroyed func(msgID string)

	// SerializeSummary turns a stored message into the JSON the
	// webhook receiver expects (full message detail, same shape as
	// GET /message/:id). Wired by main.go.
	SerializeSummary func(*store.Message) ([]byte, error)

	// Lifecycle plumbing. Zero values are safe; Start() initialises.
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// retentionInterval controls how often the retention loop wakes up
// to enforce storage.max_messages. Trades worst-case over-cap drift
// against wasted scans. Variable so tests can crank it down.
var retentionInterval = 60 * time.Second

// Start prepares the dispatcher for graceful shutdown and spawns the
// background retention loop. Subsequent AfterIngest goroutines inherit
// a cancellable context, and Shutdown will wait for them and the
// retention loop. Idempotent.
func (d *Dispatcher) Start() {
	if d.ctx != nil {
		return
	}
	d.ctx, d.cancel = context.WithCancel(context.Background())
	// Enforce retention on a ticker instead of on every ingest — the
	// SELECT COUNT(*) over messages is wasted work for the common case
	// where the inbox is well under cap, so amortise it.
	d.spawn(d.retentionLoop)
}

// retentionLoop ticks every retentionInterval and runs enforceRetention.
// First sweep fires immediately so a freshly-started binary cleans up
// any pre-existing over-cap state from a prior session.
func (d *Dispatcher) retentionLoop() {
	d.enforceRetention()
	t := time.NewTicker(retentionInterval)
	defer t.Stop()
	for {
		select {
		case <-d.ctx.Done():
			return
		case <-t.C:
			d.enforceRetention()
		}
	}
}

// Shutdown cancels every in-flight goroutine spawned by AfterIngest
// and waits for them to return, bounded by ctx. Returns ctx.Err() if
// the deadline expires before all goroutines finish — the caller can
// log "some side-effects were abandoned" in that case.
//
// No-op if Start() was never called (e.g. in tests).
func (d *Dispatcher) Shutdown(ctx context.Context) error {
	if d.cancel == nil {
		return nil
	}
	d.cancel()
	done := make(chan struct{})
	go func() {
		d.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// parentCtx returns the dispatcher's cancellable context if Start was
// called, otherwise a background context (for unstarted use in tests).
func (d *Dispatcher) parentCtx() context.Context {
	if d.ctx != nil {
		return d.ctx
	}
	return context.Background()
}

// spawn runs fn in a goroutine tracked by d.wg. When the dispatcher is
// started, Shutdown waits on the WaitGroup.
func (d *Dispatcher) spawn(fn func()) {
	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		fn()
	}()
}

// AfterIngest is called right after a successful Insert. Synchronous-
// looking but each branch dispatches to a tracked goroutine; the call
// returns immediately.
//
// Retention is NOT triggered here — see retentionLoop, which runs on a
// ticker via Start. That avoids a per-message SELECT COUNT(*).
func (d *Dispatcher) AfterIngest(msgID string) {
	d.spawn(func() { d.broadcast(msgID) })
	d.spawn(func() { d.cloudMirror(msgID) })
	d.spawn(func() { d.relayMirror(msgID) })
	d.spawn(func() { d.webhookDelivery(msgID) })
}

func (d *Dispatcher) broadcast(msgID string) {
	if d.BroadcastCreated == nil {
		return
	}
	d.BroadcastCreated(msgID)
}

// cloudMirror forwards to the connected sandbox if mirror_enabled.
func (d *Dispatcher) cloudMirror(msgID string) {
	cfg := d.Config.Get()
	mirror := false
	apiToken := ""
	var sandboxID int64

	if c, err := d.Store.CloudGet(d.parentCtx()); err == nil {
		mirror = c.MirrorEnabled
		apiToken = c.APIToken
		sandboxID = c.SandboxID
	}
	// Config overrides DB.
	if cfg.Cloud.MirrorEnabled != nil {
		mirror = *cfg.Cloud.MirrorEnabled
	}
	if cfg.Cloud.APIToken != nil {
		apiToken = *cfg.Cloud.APIToken
	}
	if cfg.Cloud.SandboxID != nil {
		sandboxID = *cfg.Cloud.SandboxID
	}
	if !mirror || apiToken == "" || sandboxID == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(d.parentCtx(), 30*time.Second)
	defer cancel()

	m, err := d.Store.Get(ctx, msgID)
	if err != nil {
		return
	}
	inline, _ := d.Store.LoadInline(ctx, m.ID)
	atts, _ := d.Store.LoadAttachments(ctx, m.ID)

	cl := cloud.NewClient(apiToken, sandboxID)
	if err := withRetry(ctx, 3, func() error {
		return cl.Send(ctx, m, inline, atts)
	}); err != nil {
		slog.Warn("cloud-mirror failed",
			slog.String("msg_id", msgID), slog.Any("err", err))
	}
}

// relayMirror auto-relays via the SMTP server if auto_relay_enabled.
func (d *Dispatcher) relayMirror(msgID string) {
	cfg := d.Config.Get()
	conn, err := d.Store.RelayGet(d.parentCtx())
	if errors.Is(err, store.ErrNotFound) {
		return
	}
	if err != nil {
		return
	}

	auto := conn.AutoRelayEnabled
	if cfg.Relay.AutoRelayEnabled != nil {
		auto = *cfg.Relay.AutoRelayEnabled
	}
	if !auto {
		return
	}

	overlay := overlayRelay(conn, cfg.Relay)

	ctx, cancel := context.WithTimeout(d.parentCtx(), 30*time.Second)
	defer cancel()

	m, err := d.Store.Get(ctx, msgID)
	if err != nil {
		return
	}
	// Auto-relay sends to whoever the SMTP envelope said RCPT TO was, and
	// mirrors the message untouched (rewriteTo=false) — rewriting To: to
	// the envelope recipients would leak any Bcc'd addresses into the
	// visible To: header.
	if err := withRetry(ctx, 3, func() error {
		return d.Relay.Forward(ctx, overlay, m, m.SMTPTo, false)
	}); err != nil {
		slog.Warn("relay-mirror failed",
			slog.String("msg_id", msgID), slog.Any("err", err))
	}
}

// webhookDelivery POSTs to the configured URL.
func (d *Dispatcher) webhookDelivery(msgID string) {
	cfg := d.Config.Get()
	conn, _ := d.Store.WebhookGet(d.parentCtx())
	url, secret, enabled := overlayWebhook(conn, cfg.Webhook)
	if !enabled || url == "" {
		return
	}
	ctx, cancel := context.WithTimeout(d.parentCtx(), 30*time.Second)
	defer cancel()
	m, err := d.Store.Get(ctx, msgID)
	if err != nil {
		return
	}

	// Wire shape mirrors the per-message detail endpoint so receivers
	// reuse the same client code.
	payload, err := d.SerializeSummary(m)
	if err != nil {
		return
	}
	if err := withRetry(ctx, 3, func() error {
		return d.Webhook.Deliver(ctx, url, secret, payload)
	}); err != nil {
		slog.Warn("webhook delivery failed",
			slog.String("msg_id", msgID), slog.Any("err", err))
	}
}

// enforceRetention deletes oldest messages if the count exceeds the
// configured cap. Default 500; 0 = unlimited.
func (d *Dispatcher) enforceRetention() {
	cfg := d.Config.Get()
	cap := 500
	if cfg.Storage.MaxMessages != nil {
		cap = *cfg.Storage.MaxMessages
	}
	if cap <= 0 {
		return
	}
	ctx := d.parentCtx()

	// Quick count
	var total int
	if err := d.Store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM messages`).Scan(&total); err != nil {
		return
	}
	if total <= cap {
		return
	}
	excess := total - cap

	// Pull the oldest excess IDs.
	rows, err := d.Store.DB().QueryContext(ctx,
		`SELECT id FROM messages ORDER BY created_at ASC LIMIT ?`, excess)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if len(ids) == 0 {
		return
	}
	deleted, err := d.Store.Delete(ctx, ids...)
	if err != nil {
		slog.Warn("retention sweep failed", slog.Any("err", err))
		return
	}
	for _, id := range deleted {
		if d.BroadcastDestroyed != nil {
			id := id // capture
			d.spawn(func() { d.BroadcastDestroyed(id) })
		}
	}
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

func withRetry(ctx context.Context, max int, fn func() error) error {
	var lastErr error
	for i := 0; i < max; i++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := fn()
		if err == nil {
			return nil
		}
		// Permanent errors don't get retried — the receiver explicitly
		// said no, retrying with the same payload won't help.
		var permCloud *cloud.PermanentError
		var permWebhook *webhook.PermanentError
		if errors.As(err, &permCloud) || errors.As(err, &permWebhook) {
			return err
		}
		lastErr = err
		if i == max-1 {
			break // no point sleeping after the final attempt
		}
		// Linear backoff, but abort promptly if the dispatcher is shutting
		// down (ctx cancelled) instead of sleeping through the deadline.
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(i+1) * 500 * time.Millisecond):
		}
	}
	return lastErr
}

func overlayRelay(db *store.RelayConnection, cfg config.Relay) *store.RelayConnection {
	out := *db // copy
	if cfg.Host != nil {
		out.Host = *cfg.Host
	}
	if cfg.Port != nil {
		out.Port = *cfg.Port
	}
	if cfg.Username != nil {
		out.Username = *cfg.Username
	}
	if cfg.Password != nil {
		out.Password = *cfg.Password
	}
	if cfg.Auth != nil {
		out.Auth = *cfg.Auth
	}
	if cfg.TLS != nil {
		out.TLS = *cfg.TLS
	}
	if cfg.AutoRelayEnabled != nil {
		out.AutoRelayEnabled = *cfg.AutoRelayEnabled
	}
	if cfg.OverrideFrom != nil {
		out.OverrideFrom = *cfg.OverrideFrom
	}
	if cfg.ReturnPath != nil {
		out.ReturnPath = *cfg.ReturnPath
	}
	return &out
}

func overlayWebhook(db *store.WebhookConnection, cfg config.Webhook) (url, secret string, enabled bool) {
	if db != nil {
		url, secret, enabled = db.URL, db.Secret, db.Enabled
	}
	if cfg.URL != nil {
		url = *cfg.URL
	}
	if cfg.Secret != nil {
		secret = *cfg.Secret
	}
	if cfg.Enabled != nil {
		enabled = *cfg.Enabled
	}
	return
}

// MarshalSummary is a convenience for SerializeSummary wiring.
func MarshalSummary(v any) ([]byte, error) { return json.Marshal(v) }
