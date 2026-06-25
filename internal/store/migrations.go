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
		prefix := strings.SplitN(e.Name(), "_", 2)[0]
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

// runMigrations applies numbered migrations after schema.sql bootstrap.
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
		for _, stmt := range splitStatements(m.sql) {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			if _, err := s.db.Exec(stmt); err != nil {
				return fmt.Errorf("migration %03d: %w\n  in stmt: %s", m.version, err, stmt)
			}
		}
		if err := s.setSchemaVersion(m.version); err != nil {
			return fmt.Errorf("migration %03d set version: %w", m.version, err)
		}
	}
	return nil
}

func (s *Store) schemaVersion() (int, error) {
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

func (s *Store) setSchemaVersion(v int) error {
	if _, err := s.db.Exec(`DELETE FROM schema_version`); err != nil {
		return wrapErr(err, "clear schema version")
	}
	_, err := s.db.Exec(`INSERT INTO schema_version(version) VALUES (?)`, v)
	return wrapErr(err, "set schema version")
}
