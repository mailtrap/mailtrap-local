package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var errTestSecretDetail = errors.New("secret sqlite detail")

func TestWriteInternalErrorHidesDetails(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/messages", nil)
	writeInternalError(rec, req, errTestSecretDetail)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	var body ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, "internal server error", body.Error)
	assert.NotContains(t, rec.Body.String(), "sqlite")
}

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
	assert.False(t, isLoopbackOrigin("https://evil.example"))
	assert.False(t, isLoopbackOrigin("not-a-url"))
	assert.False(t, isLoopbackOrigin(""))
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
