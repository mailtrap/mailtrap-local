package store

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

const migrationFilenameParts = 2

type migration struct {
	version int
	sql     string
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return nil, fmt.Errorf("read migrations dir: %w", err)
	}
	var out []migration
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		prefix := strings.SplitN(e.Name(), "_", migrationFilenameParts)[0]
		ver, err := strconv.Atoi(prefix)
		if err != nil {
			return nil, fmt.Errorf("migration filename %q: %w", e.Name(), err)
		}
		raw, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, fmt.Errorf("read migration %q: %w", e.Name(), err)
		}
		out = append(out, migration{version: ver, sql: string(raw)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

// runMigrations applies numbered migrations from internal/store/migrations/.
// Add new files as migrations/NNN_description.sql (NNN zero-padded).
func (s *Store) runMigrations() error {
	migs, err := loadMigrations()
	if err != nil {
		return err
	}
	cur, err := s.schemaVersion()
	if err != nil {
		return err
	}
	for _, m := range migs {
		if m.version <= cur {
			continue
		}
		tx, err := s.db.Begin()
		if err != nil {
			return wrapErr(err, "begin migration tx")
		}
		for _, stmt := range splitStatements(m.sql) {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if _, err := tx.Exec(stmt); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("migration %03d: %w\n  in stmt: %s", m.version, err, stmt)
			}
		}
		if err := setSchemaVersionTx(tx, m.version); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %03d set version: %w", m.version, err)
		}
		if err := tx.Commit(); err != nil {
			return wrapErr(err, "commit migration tx")
		}
	}
	return nil
}

func (s *Store) schemaVersion() (int, error) {
	var exists int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_version'`,
	).Scan(&exists); err != nil {
		return 0, wrapErr(err, "check schema_version table")
	}
	if exists == 0 {
		return 0, nil
	}
	var v int
	err := s.db.QueryRow(`SELECT version FROM schema_version LIMIT 1`).Scan(&v)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, wrapErr(err, "read schema version")
	}
	return v, nil
}

func setSchemaVersionTx(
	exec interface {
		Exec(query string, args ...any) (sql.Result, error)
	},
	v int,
) error {
	if _, err := exec.Exec(`DELETE FROM schema_version`); err != nil {
		return wrapErr(err, "clear schema version")
	}
	_, err := exec.Exec(`INSERT INTO schema_version(version) VALUES (?)`, v)
	return wrapErr(err, "set schema version")
}
