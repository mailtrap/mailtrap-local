package store

import (
	"context"
	"database/sql"
	"errors"
)

// CloudConnection mirrors the singleton row that drives forwarding to
// a Mailtrap cloud sandbox. There's at most one row at any time.
type CloudConnection struct {
	APIToken      string
	SandboxID     int64
	MirrorEnabled bool
}

// RelayConnection drives the "forward through a real SMTP relay"
// feature (per-message Forward + auto-relay). One row.
type RelayConnection struct {
	Host             string
	Port             int
	Username         string // may be ""
	Password         string // may be ""; never returned in API responses
	Auth             string // plain | login | none | cram_md5
	TLS              string // auto | ssl | off | always | never
	AutoRelayEnabled bool
	OverrideFrom     string // optional From: rewrite
	ReturnPath       string // optional MAIL FROM rewrite
}

// WebhookConnection drives outbound webhook fan-out on every newly
// captured message.
type WebhookConnection struct {
	URL     string
	Secret  string // optional; never returned in API responses
	Enabled bool
}

// ---------------------------------------------------------------------
// Cloud
// ---------------------------------------------------------------------

func (s *Store) CloudGet(ctx context.Context) (*CloudConnection, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT api_token, sandbox_id, mirror_enabled FROM cloud_connections ORDER BY id LIMIT 1`,
	)
	var c CloudConnection
	var mirror int
	err := row.Scan(&c.APIToken, &c.SandboxID, &mirror)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	c.MirrorEnabled = mirror != 0
	return &c, nil
}

// CloudUpsert replaces the singleton row.
func (s *Store) CloudUpsert(ctx context.Context, c *CloudConnection) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM cloud_connections`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cloud_connections (api_token, sandbox_id, mirror_enabled)
		VALUES (?, ?, ?)
	`, c.APIToken, c.SandboxID, boolToInt(c.MirrorEnabled))
	return err
}

func (s *Store) CloudDelete(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM cloud_connections`)
	return err
}

// ---------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------

func (s *Store) RelayGet(ctx context.Context) (*RelayConnection, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT host, port, username, password, auth, tls,
		       auto_relay_enabled, override_from, return_path
		FROM relay_connections ORDER BY id LIMIT 1
	`)
	var r RelayConnection
	var autoR int
	var username, password, override, returnP sql.NullString
	err := row.Scan(&r.Host, &r.Port, &username, &password,
		&r.Auth, &r.TLS, &autoR, &override, &returnP)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.Username = username.String
	r.Password = password.String
	r.AutoRelayEnabled = autoR != 0
	r.OverrideFrom = override.String
	r.ReturnPath = returnP.String
	return &r, nil
}

func (s *Store) RelayUpsert(ctx context.Context, r *RelayConnection) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM relay_connections`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO relay_connections (
			host, port, username, password, auth, tls,
			auto_relay_enabled, override_from, return_path
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		r.Host, r.Port,
		nullString(r.Username), nullString(r.Password),
		r.Auth, r.TLS, boolToInt(r.AutoRelayEnabled),
		nullString(r.OverrideFrom), nullString(r.ReturnPath),
	)
	return err
}

func (s *Store) RelayDelete(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM relay_connections`)
	return err
}

// ---------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------

func (s *Store) WebhookGet(ctx context.Context) (*WebhookConnection, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT url, secret, enabled FROM webhook_connections ORDER BY id LIMIT 1`,
	)
	var w WebhookConnection
	var enabled int
	var secret sql.NullString
	err := row.Scan(&w.URL, &secret, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	w.Secret = secret.String
	w.Enabled = enabled != 0
	return &w, nil
}

func (s *Store) WebhookUpsert(ctx context.Context, w *WebhookConnection) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM webhook_connections`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO webhook_connections (url, secret, enabled)
		VALUES (?, ?, ?)
	`, w.URL, nullString(w.Secret), boolToInt(w.Enabled))
	return err
}

func (s *Store) WebhookDelete(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM webhook_connections`)
	return err
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
