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
