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
	"log"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/cloud"
	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
)

// Dispatcher fans out post-ingest work to background goroutines.
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
}

// AfterIngest is called right after a successful Insert. Synchronous-
// looking but each branch dispatches to a goroutine; the call returns
// immediately.
func (d *Dispatcher) AfterIngest(msgID string) {
	go d.broadcast(msgID)
	go d.cloudMirror(msgID)
	go d.relayMirror(msgID)
	go d.webhookDelivery(msgID)
	go d.enforceRetention()
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

	if c, err := d.Store.CloudGet(context.Background()); err == nil {
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	m, err := d.Store.Get(ctx, msgID)
	if err != nil {
		return
	}
	inline, _ := d.Store.LoadInline(ctx, m.ID)
	atts, _ := d.Store.LoadAttachments(ctx, m.ID)

	cl := cloud.NewClient(apiToken, sandboxID)
	if err := withRetry(3, func() error {
		return cl.Send(ctx, m, inline, atts)
	}); err != nil {
		log.Printf("[cloud-mirror] %s: %v", msgID, err)
	}
}

// relayMirror auto-relays via the SMTP server if auto_relay_enabled.
func (d *Dispatcher) relayMirror(msgID string) {
	cfg := d.Config.Get()
	conn, err := d.Store.RelayGet(context.Background())
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

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	m, err := d.Store.Get(ctx, msgID)
	if err != nil {
		return
	}
	// Auto-relay sends to whoever the SMTP envelope said RCPT TO was.
	if err := withRetry(3, func() error {
		return d.Relay.Forward(ctx, overlay, m, m.SMTPTo)
	}); err != nil {
		log.Printf("[relay-mirror] %s: %v", msgID, err)
	}
}

// webhookDelivery POSTs to the configured URL.
func (d *Dispatcher) webhookDelivery(msgID string) {
	cfg := d.Config.Get()
	conn, _ := d.Store.WebhookGet(context.Background())
	url, secret, enabled := overlayWebhook(conn, cfg.Webhook)
	if !enabled || url == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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
	if err := withRetry(3, func() error {
		return d.Webhook.Deliver(ctx, url, secret, payload)
	}); err != nil {
		log.Printf("[webhook] %s: %v", msgID, err)
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
	ctx := context.Background()

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
		log.Printf("[retention] %v", err)
		return
	}
	for _, id := range deleted {
		if d.BroadcastDestroyed != nil {
			go d.BroadcastDestroyed(id)
		}
	}
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

func withRetry(max int, fn func() error) error {
	var lastErr error
	for i := 0; i < max; i++ {
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
		// Linear backoff is fine for our scale (single-dev local tool).
		time.Sleep(time.Duration(i+1) * 500 * time.Millisecond)
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
