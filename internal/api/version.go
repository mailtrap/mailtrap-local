package api

import "net/http"

// BuildInfo holds ldflags-injected identity surfaced by GET /version.
type BuildInfo struct {
	Version   string
	Commit    string
	BuildDate string
}

// VersionResponse is the wire shape for GET /api/v1/version.
type VersionResponse struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"build_date"`
}

func (s *Server) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, VersionResponse{
		Version:   s.Build.Version,
		Commit:    s.Build.Commit,
		BuildDate: s.Build.BuildDate,
	})
}
