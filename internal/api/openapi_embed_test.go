package api

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEmbeddedOpenAPIMatchesDocs asserts the //go:embed copy stays in sync
// with the canonical spec. CI and release builds copy docs → cmd; this catches
// drift in a plain `go test` checkout.
func TestEmbeddedOpenAPIMatchesDocs(t *testing.T) {
	docsPath := openapiSpecPath(t)
	docsBytes, err := os.ReadFile(docsPath)
	require.NoError(t, err)

	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	root := filepath.Join(filepath.Dir(thisFile), "..", "..")
	embedPath := filepath.Join(root, "cmd", "mailtrap-local", "openapi.yaml")
	embedBytes, err := os.ReadFile(embedPath)
	require.NoError(t, err)

	assert.Equal(t, string(docsBytes), string(embedBytes),
		"cmd/mailtrap-local/openapi.yaml must match docs/api/openapi.yaml")
}
