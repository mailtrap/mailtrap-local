package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenSetsSchemaVersion(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	v, err := s.schemaVersion()
	require.NoError(t, err)
	assert.Equal(t, 1, v)
}

func TestMigrationsAreIdempotent(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	require.NoError(t, s.runMigrations())
	v, err := s.schemaVersion()
	require.NoError(t, err)
	assert.Equal(t, 1, v)
}

func TestFailedMigrationDoesNotAdvanceVersion(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)

	tx, err := s.db.Begin()
	require.NoError(t, err)
	_, err = tx.Exec(`ALTER TABLE messages ADD COLUMN migration_test_col TEXT`)
	require.NoError(t, err)
	// Duplicate ADD COLUMN fails; version bump must not commit with it.
	_, err = tx.Exec(`ALTER TABLE messages ADD COLUMN migration_test_col TEXT`)
	require.Error(t, err)
	require.NoError(t, tx.Rollback())

	v, err := s.schemaVersion()
	require.NoError(t, err)
	assert.Equal(t, 1, v)

	var count int
	require.NoError(t, s.db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'migration_test_col'`,
	).Scan(&count))
	assert.Equal(t, 0, count)
}
