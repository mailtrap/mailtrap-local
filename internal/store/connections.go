package store

import (
	"context"
	"database/sql"
	"errors"

	"github.com/mailtrap/mailtrap-local/internal/secrets"
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
// Encryption helpers — wrap secrets.Box with the legacy-plaintext
// migration policy. If the Store has no Box attached (tests), values
// pass through as-is. If a stored value isn't in encrypted format, it's
// treated as legacy plaintext and re-encrypted on next write.
// ---------------------------------------------------------------------

func (s *Store) encryptForStorage(plaintext string) (string, error) {
	if s.secrets == nil {
		return plaintext, nil
	}
	out, err := s.secrets.Encrypt(plaintext)
	return out, wrapErr(err, "encrypt")
}

func (s *Store) decryptFromStorage(stored string) (string, error) {
	if s.secrets == nil {
		return stored, nil
	}
	out, err := s.secrets.Decrypt(stored)
	return out, wrapErr(err, "decrypt")
}

// needsReencryption reports whether `stored` is plaintext that should
// be migrated next time we write the row out. Used to silently upgrade
// pre-encryption databases.
func (s *Store) needsReencryption(stored string) bool {
	return s.secrets != nil && stored != "" && !secrets.IsEncrypted(stored)
}

// ---------------------------------------------------------------------
// Cloud
// ---------------------------------------------------------------------

func (s *Store) CloudGet(ctx context.Context) (*CloudConnection, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT api_token, sandbox_id, mirror_enabled FROM cloud_connections ORDER BY id LIMIT 1`,
	)
	var stored string
	var c CloudConnection
	var mirror int
	err := row.Scan(&stored, &c.SandboxID, &mirror)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, wrapErr(err, "scan")
	}
	pt, err := s.decryptFromStorage(stored)
	if err != nil {
		return nil, wrapErr(err, "scan")
	}
	c.APIToken = pt
	c.MirrorEnabled = mirror != 0

	// Lazy migration: re-encrypt legacy plaintext rows in place.
	if s.needsReencryption(stored) {
		_ = s.CloudUpsert(ctx, &c) // best-effort; failure leaves plaintext
	}
	return &c, nil
}

// CloudUpsert replaces the singleton row.
func (s *Store) CloudUpsert(ctx context.Context, c *CloudConnection) error {
	enc, err := s.encryptForStorage(c.APIToken)
	if err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM cloud_connections`); err != nil {
		return wrapErr(err, "delete cloud")
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO cloud_connections (id, api_token, sandbox_id, mirror_enabled)
		VALUES (1, ?, ?, ?)
	`, enc, c.SandboxID, boolToInt(c.MirrorEnabled))
	return wrapErr(err, "insert cloud")
}

func (s *Store) CloudDelete(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM cloud_connections`)
	return wrapErr(err, "delete cloud")
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
		return nil, wrapErr(err, "scan")
	}
	pt, err := s.decryptFromStorage(password.String)
	if err != nil {
		return nil, wrapErr(err, "scan")
	}
	r.Username = username.String
	r.Password = pt
	r.AutoRelayEnabled = autoR != 0
	r.OverrideFrom = override.String
	r.ReturnPath = returnP.String

	if s.needsReencryption(password.String) {
		_ = s.RelayUpsert(ctx, &r) // best-effort migration
	}
	return &r, nil
}

func (s *Store) RelayUpsert(ctx context.Context, r *RelayConnection) error {
	enc, err := s.encryptForStorage(r.Password)
	if err != nil {
		return wrapErr(err, "encrypt relay password")
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM relay_connections`); err != nil {
		return wrapErr(err, "delete relay")
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO relay_connections (
			id, host, port, username, password, auth, tls,
			auto_relay_enabled, override_from, return_path
		) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		r.Host, r.Port,
		nullString(r.Username), nullString(enc),
		r.Auth, r.TLS, boolToInt(r.AutoRelayEnabled),
		nullString(r.OverrideFrom), nullString(r.ReturnPath),
	)
	return wrapErr(err, "insert relay")
}

func (s *Store) RelayDelete(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM relay_connections`)
	return wrapErr(err, "delete relay")
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
		return nil, wrapErr(err, "scan")
	}
	pt, err := s.decryptFromStorage(secret.String)
	if err != nil {
		return nil, wrapErr(err, "scan")
	}
	w.Secret = pt
	w.Enabled = enabled != 0

	if s.needsReencryption(secret.String) {
		_ = s.WebhookUpsert(ctx, &w) // best-effort migration
	}
	return &w, nil
}

func (s *Store) WebhookUpsert(ctx context.Context, w *WebhookConnection) error {
	enc, err := s.encryptForStorage(w.Secret)
	if err != nil {
		return wrapErr(err, "encrypt webhook secret")
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM webhook_connections`); err != nil {
		return wrapErr(err, "delete webhook")
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO webhook_connections (id, url, secret, enabled)
		VALUES (1, ?, ?, ?)
	`, w.URL, nullString(enc), boolToInt(w.Enabled))
	return wrapErr(err, "insert webhook")
}

func (s *Store) WebhookDelete(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM webhook_connections`)
	return wrapErr(err, "delete webhook")
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
