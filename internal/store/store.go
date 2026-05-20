// Package store owns the SQLite database — schema, models, queries.
//
// Single struct (Store) encapsulates the *sql.DB plus prepared
// statements. The handler layer never sees raw SQL; tests can inject a
// :memory: store via OpenMemory.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/mailtrap/mailtrap-local/internal/secrets"
	_ "modernc.org/sqlite" // pure-Go SQLite driver (driver name: "sqlite")
)

//go:embed schema.sql
var schemaFS embed.FS

// Store wraps a *sql.DB opened against SQLite. Safe for concurrent use.
// SQLite is single-writer, so we let database/sql's connection pool
// serialize writes naturally; reads scale across the pool.
type Store struct {
	db      *sql.DB
	secrets *secrets.Box // nil-safe: nil means "store values verbatim" (tests)
}

// SetSecrets attaches a secrets.Box for at-rest encryption of the
// sensitive connection fields (cloud API token, relay password,
// webhook secret). Without it, the Store falls back to plaintext —
// fine for unit tests, never used by the real binary which always
// calls SetSecrets right after Open.
func (s *Store) SetSecrets(box *secrets.Box) { s.secrets = box }

// Open returns a Store backed by the SQLite file at `path`. Creates the
// file (and its parent directory) if missing, applies the schema on
// first open, enables WAL + foreign keys.
//
// The empty path is treated as ":memory:" (used by tests).
func Open(path string) (*Store, error) {
	// modernc.org/sqlite DSN: pragma values are per-connection-init,
	// applied every time the pool opens a new connection.
	//   foreign_keys(1)       → enforce FK constraints (off by default)
	//   journal_mode(WAL)     → readers don't block writers (file DBs)
	//   busy_timeout(5000)    → wait 5s for a write lock vs SQLITE_BUSY
	memory := path == "" || path == ":memory:"
	var dsn string
	if memory {
		// Plain ":memory:" — each connection gets its OWN database.
		// We pin the pool to a single connection so all queries hit
		// the same DB. (`cache=shared` would let tests leak into each
		// other across Stores in the same process.)
		dsn = "file::memory:?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"
	} else {
		if err := ensureDir(filepath.Dir(path)); err != nil {
			return nil, fmt.Errorf("ensure data dir: %w", err)
		}
		dsn = path + "?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if memory {
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
	} else {
		// SQLite is single-writer; over-provisioning hurts.
		db.SetMaxOpenConns(8)
		db.SetMaxIdleConns(8)
	}

	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	s := &Store{db: db}
	if err := s.applySchema(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// OpenMemory is a convenience for tests.
func OpenMemory() (*Store, error) { return Open(":memory:") }

// Close releases the underlying connection pool.
func (s *Store) Close() error { return s.db.Close() }

// DB exposes the raw handle for low-level operations / tests.
func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) applySchema() error {
	raw, err := schemaFS.ReadFile("schema.sql")
	if err != nil {
		return fmt.Errorf("read schema: %w", err)
	}
	// CREATE TABLE / INDEX / VIRTUAL TABLE statements are idempotent
	// (IF NOT EXISTS).
	for _, stmt := range splitStatements(string(raw)) {
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		if _, err := s.db.Exec(stmt); err != nil {
			return fmt.Errorf("apply schema: %w\n  in stmt: %s", err, stmt)
		}
	}
	// FTS triggers live here (not schema.sql) because splitStatements
	// doesn't understand BEGIN...END.
	for _, t := range ftsTriggers {
		if _, err := s.db.Exec(t); err != nil {
			return fmt.Errorf("apply fts trigger: %w\n  in stmt: %s", err, t)
		}
	}
	// First-time backfill: if there are messages but no FTS rows
	// (existing DB upgraded from a schema without FTS), rebuild the
	// index. Subsequent boots find the index populated and skip.
	if err := s.backfillFTSIfNeeded(); err != nil {
		return fmt.Errorf("backfill fts: %w", err)
	}
	return nil
}

// ftsTriggers keeps messages_fts in sync with messages. External-
// content FTS5 stores no row data of its own, so the triggers fire on
// every messages row change and rebuild that row's tokens.
var ftsTriggers = []string{
	`CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
		INSERT INTO messages_fts (rowid, subject, from_name, from_address, recipients_text, snippet, text_body, category)
		VALUES (new.rowid, new.subject, new.from_name, new.from_address, new.recipients_text, new.snippet, new.text_body, COALESCE(new.category, ''));
	END`,
	`CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
		INSERT INTO messages_fts (messages_fts, rowid, subject, from_name, from_address, recipients_text, snippet, text_body, category)
		VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_address, old.recipients_text, old.snippet, old.text_body, COALESCE(old.category, ''));
	END`,
	`CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
		INSERT INTO messages_fts (messages_fts, rowid, subject, from_name, from_address, recipients_text, snippet, text_body, category)
		VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_address, old.recipients_text, old.snippet, old.text_body, COALESCE(old.category, ''));
		INSERT INTO messages_fts (rowid, subject, from_name, from_address, recipients_text, snippet, text_body, category)
		VALUES (new.rowid, new.subject, new.from_name, new.from_address, new.recipients_text, new.snippet, new.text_body, COALESCE(new.category, ''));
	END`,
}

// backfillFTSIfNeeded rebuilds the FTS index when an upgraded DB has
// messages but no indexed tokens (the trigger only fires on writes
// after install, so pre-existing rows wouldn't show up otherwise).
//
// External-content FTS5 makes `SELECT COUNT(*) FROM messages_fts`
// proxy through to the content table, so it's useless for "is the
// index populated?". The shadow table `messages_fts_docsize` holds
// one row per *indexed* document — that's the right signal.
func (s *Store) backfillFTSIfNeeded() error {
	var msgCount int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&msgCount); err != nil {
		return err
	}
	if msgCount == 0 {
		return nil
	}
	var indexed int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM messages_fts_docsize`).Scan(&indexed); err != nil {
		return err
	}
	if indexed >= msgCount {
		return nil
	}
	_, err := s.db.Exec(`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`)
	return err
}

// splitStatements splits a multi-statement SQL string on `;` boundaries.
// Crude but sufficient: our schema has no string literals containing
// semicolons, no triggers, no procedures.
func splitStatements(s string) []string {
	return strings.Split(s, ";")
}

// ErrNotFound is returned by the Get helpers when the requested row
// doesn't exist. Callers can check with errors.Is.
var ErrNotFound = errors.New("store: not found")

func ensureDir(dir string) error {
	if dir == "" || dir == "." {
		return nil
	}
	return mkdirAll(dir)
}
