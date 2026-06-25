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
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/cloud"
	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
)

const (
	defaultRetentionCap = 500
	sideEffectTimeout   = 30 * time.Second
	sideEffectRetries   = 3
	retryBackoffBase    = 500 * time.Millisecond
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
	done   chan struct{} // closed on shutdown; nil when not started
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// dispatcherContext is a minimal context.Context whose Done channel
// mirrors the dispatcher shutdown signal without storing a context.Context
// on the Dispatcher struct (containedctx).
type dispatcherContext struct {
	done <-chan struct{}
}

func (c *dispatcherContext) Deadline() (time.Time, bool) { return time.Time{}, false }
func (c *dispatcherContext) Done() <-chan struct{}       { return c.done }
func (c *dispatcherContext) Err() error {
	select {
	case <-c.done:
		return context.Canceled
	default:
		return nil
	}
}
func (c *dispatcherContext) Value(key any) any { return nil }

// retentionInterval controls how often the retention loop wakes up
// to enforce storage.max_messages. Trades worst-case over-cap drift
// against wasted scans. Variable so tests can crank it down.
var retentionInterval = 60 * time.Second

// Start prepares the dispatcher for graceful shutdown and spawns the
// background retention loop. Subsequent AfterIngest goroutines inherit
// a cancellable context, and Shutdown will wait for them and the
// retention loop. Idempotent.
func (d *Dispatcher) Start() {
	if d.cancel != nil {
		return
	}
	done := make(chan struct{})
	var closeOnce sync.Once
	d.done = done
	d.cancel = func() {
		closeOnce.Do(func() { close(done) })
	}
	// Enforce retention on a ticker instead of on every ingest — the
	// SELECT COUNT(*) over messages is wasted work for the common case
	// where the inbox is well under cap, so amortise it.
	d.spawn(d.retentionLoop)
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
		return fmt.Errorf("dispatcher shutdown: %w", ctx.Err())
	}
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

// MarshalSummary is a convenience for SerializeSummary wiring.
func MarshalSummary(v any) ([]byte, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal summary: %w", err)
	}
	return b, nil
}

func (d *Dispatcher) retentionLoop() {
	d.enforceRetention()
	t := time.NewTicker(retentionInterval)
	defer t.Stop()
	for {
		select {
		case <-d.done:
			return
		case <-t.C:
			d.enforceRetention()
		}
	}
}

func (d *Dispatcher) parentCtx() context.Context {
	if d.done == nil {
		return context.Background()
	}
	return &dispatcherContext{done: d.done}
}

func (d *Dispatcher) spawn(fn func()) {
	d.wg.Go(func() {
		fn()
	})
}

func (d *Dispatcher) broadcast(msgID string) {
	if d.BroadcastCreated == nil {
		return
	}
	d.BroadcastCreated(msgID)
}

func (d *Dispatcher) cloudMirror(msgID string) {
	cfg := d.Config.Get()
	mirror := false
	apiToken := ""
	var sandboxID int64

	if c, err := d.Store.CloudGet(d.parentCtx()); err == nil {
		mirror = c.MirrorEnabled
		apiToken = c.APIToken
		sandboxID = c.SandboxID
	} else if !errors.Is(err, store.ErrNotFound) {
		slog.Warn("cloud-mirror: load cloud connection", slog.Any("err", err))
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

	ctx, cancel := context.WithTimeout(d.parentCtx(), sideEffectTimeout)
	defer cancel()

	m, err := d.Store.Get(ctx, msgID)
	if err != nil {
		slog.Warn("cloud-mirror: load message",
			slog.String("msg_id", msgID), slog.Any("err", err))
		return
	}
	inline, _ := d.Store.LoadInline(ctx, m.ID)
	atts, _ := d.Store.LoadAttachments(ctx, m.ID)

	cl := cloud.NewClient(apiToken, sandboxID)
	if err := withRetry(ctx, func() error {
		return cl.Send(ctx, m, inline, atts)
	}); err != nil {
		slog.Warn("cloud-mirror failed",
			slog.String("msg_id", msgID), slog.Any("err", err))
	}
}

func (d *Dispatcher) relayMirror(msgID string) {
	cfg := d.Config.Get()
	conn, err := d.Store.RelayGet(d.parentCtx())
	if errors.Is(err, store.ErrNotFound) {
		return
	}
	if err != nil {
		slog.Warn("relay-mirror: load relay connection", slog.Any("err", err))
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

	ctx, cancel := context.WithTimeout(d.parentCtx(), sideEffectTimeout)
	defer cancel()

	m, err := d.Store.Get(ctx, msgID)
	if err != nil {
		slog.Warn("relay-mirror: load message",
			slog.String("msg_id", msgID), slog.Any("err", err))
		return
	}
	// Auto-relay sends to whoever the SMTP envelope said RCPT TO was, and
	// mirrors the message untouched (rewriteTo=false) — rewriting To: to
	// the envelope recipients would leak any Bcc'd addresses into the
	// visible To: header.
	if err := withRetry(ctx, func() error {
		return d.Relay.Forward(ctx, overlay, m, m.SMTPTo, false)
	}); err != nil {
		slog.Warn("relay-mirror failed",
			slog.String("msg_id", msgID), slog.Any("err", err))
	}
}

func (d *Dispatcher) webhookDelivery(msgID string) {
	cfg := d.Config.Get()
	conn, err := d.Store.WebhookGet(d.parentCtx())
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		slog.Warn("webhook-delivery: load webhook connection", slog.Any("err", err))
	}
	whURL, secret, enabled := overlayWebhook(conn, cfg.Webhook)
	if !enabled || whURL == "" {
		return
	}
	ctx, cancel := context.WithTimeout(d.parentCtx(), sideEffectTimeout)
	defer cancel()
	m, err := d.Store.Get(ctx, msgID)
	if err != nil {
		slog.Warn("webhook-delivery: load message",
			slog.String("msg_id", msgID), slog.Any("err", err))
		return
	}

	// Wire shape mirrors the per-message detail endpoint so receivers
	// reuse the same client code.
	payload, err := d.SerializeSummary(m)
	if err != nil {
		slog.Warn("webhook-delivery: serialize message",
			slog.String("msg_id", msgID), slog.Any("err", err))
		return
	}
	if err := withRetry(ctx, func() error {
		return d.Webhook.Deliver(ctx, whURL, secret, payload)
	}); err != nil {
		slog.Warn("webhook delivery failed",
			slog.String("msg_id", msgID), slog.Any("err", err))
	}
}

func (d *Dispatcher) enforceRetention() {
	cfg := d.Config.Get()
	messageCap := defaultRetentionCap
	if cfg.Storage.MaxMessages != nil {
		messageCap = *cfg.Storage.MaxMessages
	}
	if messageCap <= 0 {
		return
	}
	ctx := d.parentCtx()

	// Quick count
	var total int
	if err := d.Store.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM messages`).Scan(&total); err != nil {
		return
	}
	if total <= messageCap {
		return
	}
	excess := total - messageCap

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
	_ = rows.Close()
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

func withRetry(ctx context.Context, fn func() error) error {
	var lastErr error
	for i := range sideEffectRetries {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("retry aborted: %w", err)
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
		if i == sideEffectRetries-1 {
			break // no point sleeping after the final attempt
		}
		// Linear backoff, but abort promptly if the dispatcher is shutting
		// down (ctx cancelled) instead of sleeping through the deadline.
		select {
		case <-ctx.Done():
			return fmt.Errorf("retry aborted: %w", ctx.Err())
		case <-time.After(time.Duration(i+1) * retryBackoffBase):
		}
	}
	return lastErr
}

func overlayRelay(db *store.RelayConnection, cfg config.Relay) *store.RelayConnection {
	out := *db
	config.OverlayRelay(&out, cfg)
	return &out
}

func overlayWebhook(db *store.WebhookConnection, cfg config.Webhook) (string, string, bool) {
	var whURL, secret string
	var enabled bool
	if db != nil {
		whURL, secret, enabled = db.URL, db.Secret, db.Enabled
	}
	if cfg.URL != nil {
		whURL = *cfg.URL
	}
	if cfg.Secret != nil {
		secret = *cfg.Secret
	}
	if cfg.Enabled != nil {
		enabled = *cfg.Enabled
	}
	return whURL, secret, enabled
}
