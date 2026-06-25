package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
)

const (
	httpStatusServerError = 500
	httpStatusClientError = 400
)

type ctxKey int

const loggerCtxKey ctxKey = iota

// requestLogger generates (or accepts) a request ID, stashes a
// per-request slog.Logger in the context with `rid` / `method` /
// `path` attached, and logs one INFO line per request including the
// status code and duration.
//
// Mounted only on /api/v1/* (not on the SPA static handler) — there's
// no point logging every CSS asset GET.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("X-Request-Id")
		if rid == "" {
			rid = uuid.NewString()
		}
		w.Header().Set("X-Request-Id", rid)

		logger := slog.Default().With(
			slog.String("rid", rid),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
		)
		ctx := context.WithValue(r.Context(), loggerCtxKey, logger)

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(rec, r.WithContext(ctx))

		level := slog.LevelInfo
		if rec.status >= httpStatusServerError {
			level = slog.LevelError
		} else if rec.status >= httpStatusClientError {
			level = slog.LevelWarn
		}
		loggerFrom(ctx).LogAttrs(ctx, level, "request",
			slog.Int("status", rec.status),
			slog.Duration("dur", time.Since(start)),
		)
	})
}

// loggerFrom returns the per-request logger if one was installed by
// requestLogger; otherwise the package default. Handlers can use this
// when they want to attach an event-specific attribute (e.g. a
// message ID) without losing the request-ID context.
func loggerFrom(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerCtxKey).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// statusRecorder captures the HTTP status code for the access log.
type statusRecorder struct {
	http.ResponseWriter

	status int
	wrote  bool
}

func (r *statusRecorder) WriteHeader(c int) {
	r.status = c
	r.wrote = true
	r.ResponseWriter.WriteHeader(c)
}

// Write triggers an implicit 200 if WriteHeader wasn't called.
// statusRecorder.status defaults to 200, so we just need to mark wrote.
func (r *statusRecorder) Write(b []byte) (int, error) {
	r.wrote = true
	n, err := r.ResponseWriter.Write(b)
	if err != nil {
		return n, fmt.Errorf("write response: %w", err)
	}
	return n, nil
}
