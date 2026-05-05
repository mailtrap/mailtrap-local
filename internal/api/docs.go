package api

import (
	"net/http"
)

// Documented at https://docs.mailtrap.io/. The API discovery surface
// (openapi.yaml + redirect) lets clients introspect the wire format
// without running the SPA.
const docsURL = "https://docs.mailtrap.io/"

// openapiYAML serves the embedded OpenAPI 3.1 spec.
// Returns 404 when the binary was built without the embedded spec
// (the dev build runs from source and includes it; release builds
// always do).
func (s *Server) openapiYAML(w http.ResponseWriter, _ *http.Request) {
	if len(s.OpenAPI) == 0 {
		writeError(w, http.StatusNotFound, "OpenAPI spec not embedded in this build")
		return
	}
	w.Header().Set("Content-Type", "application/yaml")
	w.Header().Set("Content-Disposition", `inline; filename="openapi.yaml"`)
	_, _ = w.Write(s.OpenAPI)
}

// docsRedirect handles GET /api/v1 — 302 to the hosted docs site.
func (s *Server) docsRedirect(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, docsURL, http.StatusFound)
}
