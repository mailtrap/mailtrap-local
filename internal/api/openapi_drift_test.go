package api

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/mailtrap/mailtrap-local/internal/live"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// TestOpenAPIDrift walks the live chi router and asserts every public
// `/api/v1/*` path appears in docs/api/openapi.yaml — and vice versa.
// Adding a route without speccing it (or removing one and forgetting
// to clean up the spec) breaks this test.
func TestOpenAPIDrift(t *testing.T) {
	st, _ := store.OpenMemory()
	defer st.Close()
	srv := &Server{
		Store:   st,
		Hub:     live.NewHub(),
		Relay:   &relay.Client{},
		Webhook: webhook.NewClient(),
	}

	r := srv.Router().(*chi.Mux)
	routerPaths := map[string]bool{}
	walk := func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		// Strip chi's regex constraints; openapi uses {name} placeholders.
		clean := chiToOpenAPIPath(route)
		// We only diff the documented public surface — skip /cable
		// (WebSocket; not represented in OpenAPI) and the SPA fallback.
		if clean == "/cable" || !strings.HasPrefix(clean, "/api/v1") {
			return nil
		}
		routerPaths[clean] = true
		return nil
	}
	err := chi.Walk(r, walk)
	require.NoError(t, err)

	specPath := openapiSpecPath(t)
	specBytes, err := os.ReadFile(specPath)
	require.NoError(t, err)

	var spec struct {
		Paths map[string]any `yaml:"paths"`
	}
	err = yaml.Unmarshal(specBytes, &spec)
	require.NoError(t, err)
	specPaths := map[string]bool{}
	for p := range spec.Paths {
		specPaths[p] = true
	}

	// Allowlist: paths that exist in the router but intentionally are
	// NOT in the public spec (e.g. internal-only or self-referential).
	omitted := map[string]bool{
		"/api/v1":              true, // bare-path redirect
		"/api/v1/openapi.yaml": true, // documenting the spec inside itself = recursive
	}

	missingFromSpec := []string{}
	for p := range routerPaths {
		if omitted[p] {
			continue
		}
		if !specPaths[p] {
			missingFromSpec = append(missingFromSpec, p)
		}
	}
	extraInSpec := []string{}
	for p := range specPaths {
		if !routerPaths[p] {
			extraInSpec = append(extraInSpec, p)
		}
	}

	assert.Emptyf(t, missingFromSpec, "router paths missing from openapi.yaml — add them or extend the test omit list:\n  %v",
		missingFromSpec)
	assert.Emptyf(t, extraInSpec, "openapi.yaml documents paths the router doesn't serve:\n  %v",
		extraInSpec)
}

// chiToOpenAPIPath converts chi's `/foo/{id}` into the OpenAPI form
// (which is identical) and strips the trailing `/*` SPA fallback.
func chiToOpenAPIPath(p string) string {
	// chi route regex constraints look like {id:[0-9]+}; openapi has
	// {id}. Strip the regex.
	re := regexp.MustCompile(`{([^:}]+):[^}]+}`)
	p = re.ReplaceAllString(p, "{$1}")
	// Strip a trailing "/" on grouped roots so /api/v1/ matches /api/v1.
	if strings.HasSuffix(p, "/") && p != "/" {
		p = strings.TrimRight(p, "/")
	}
	return p
}

// openapiSpecPath finds docs/api/openapi.yaml relative to this test
// file (which lives in internal/api/).
func openapiSpecPath(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	root := filepath.Join(filepath.Dir(thisFile), "..", "..")
	return filepath.Join(root, "docs", "api", "openapi.yaml")
}
