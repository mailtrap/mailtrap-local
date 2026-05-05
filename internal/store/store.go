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

	_ "modernc.org/sqlite" // pure-Go SQLite driver (driver name: "sqlite")
)

//go:embed schema.sql
var schemaFS embed.FS

// Store wraps a *sql.DB opened against SQLite. Safe for concurrent use.
// SQLite is single-writer, so we let database/sql's connection pool
// serialize writes naturally; reads scale across the pool.
type Store struct {
	db *sql.DB
}

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
	// CREATE TABLE / INDEX statements are idempotent (IF NOT EXISTS).
	for _, stmt := range splitStatements(string(raw)) {
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		if _, err := s.db.Exec(stmt); err != nil {
			return fmt.Errorf("apply schema: %w\n  in stmt: %s", err, stmt)
		}
	}
	return nil
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
