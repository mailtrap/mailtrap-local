package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/mailtrap/mailtrap-local/internal/peer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseInt(t *testing.T) {
	t.Parallel()
	assert.Equal(t, 10, parseInt("10", 5))
	assert.Equal(t, 5, parseInt("", 5))
	assert.Equal(t, 5, parseInt("nope", 5))
}

func TestClamp(t *testing.T) {
	t.Parallel()
	assert.Equal(t, 5, clamp(5, 1, 10))
	assert.Equal(t, 1, clamp(0, 1, 10))
	assert.Equal(t, 10, clamp(99, 1, 10))
}

func TestIsLoopbackOrigin(t *testing.T) {
	t.Parallel()
	assert.True(t, isLoopbackOrigin("http://127.0.0.1:3540"))
	assert.True(t, isLoopbackOrigin("http://localhost:3540"))
	assert.True(t, isLoopbackOrigin("http://[::1]:8080"))
	assert.True(t, isLoopbackOrigin("http://app.localhost:3550"))
	assert.True(t, isLoopbackOrigin("http://localhost.:3550"))
	assert.False(t, isLoopbackOrigin("https://evil.example"))
	assert.False(t, isLoopbackOrigin("http://localhost.evil.example"))
	assert.False(t, isLoopbackOrigin("null"))
	assert.False(t, isLoopbackOrigin("not-a-url"))
	assert.False(t, isLoopbackOrigin(""))
}

func TestIsLocalHost(t *testing.T) {
	t.Parallel()
	for _, h := range []string{
		"127.0.0.1:3550", "localhost:3550", "LOCALHOST", "[::1]:3550",
		"app.localhost:3550", "mailtrap-local:3550", "host.docker.internal:3550",
		"john.dev:3550", "JOHN.DEV", "localhost.:3550", "app.localhost.:3550", "john.dev.:3550",
	} {
		assert.True(t, isLocalHost(h, []string{"john.dev"}), h)
	}
	for _, h := range []string{
		"", "192.168.1.5:3550", "[fe80::1]:3550", "evil.example:3550",
		"localhost.evil.example", "devbox.local:3550", "sub.john.dev:3550",
		"mailtrap-local.:3550",
	} {
		assert.False(t, isLocalHost(h, []string{"john.dev"}), h)
	}
}

func TestLocalOnlyRejectsOtherMachines(t *testing.T) {
	t.Parallel()
	allow, err := peer.Parse("172.16.0.0/12")
	require.NoError(t, err)
	s := &Server{AllowFrom: allow}
	handler := s.localOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	status := func(remote string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/messages", nil)
		req.Host = "localhost:3550"
		req.RemoteAddr = remote
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	assert.Equal(t, http.StatusOK, status("127.0.0.1:50000"))
	assert.Equal(t, http.StatusOK, status("[::1]:50000"))
	assert.Equal(t, http.StatusOK, status("172.17.0.1:50000"))
	assert.Equal(t, http.StatusForbidden, status("192.168.1.5:50000"))
}

func TestCORSOptionsPreflight(t *testing.T) {
	t.Parallel()
	handler := corsLoopback(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/messages", nil)
	req.Header.Set("Origin", "http://127.0.0.1:3540")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, "http://127.0.0.1:3540", rec.Header().Get("Access-Control-Allow-Origin"))
}

func TestSPAHandlerFallbackToIndex(t *testing.T) {
	t.Parallel()
	root := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>app</html>")},
	}
	handler := spaHandler(root)

	req := httptest.NewRequest(http.MethodGet, "/messages/abc", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "app")
}
