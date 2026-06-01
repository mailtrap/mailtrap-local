# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the single-binary mailtrap-local.
#
#   Stage 1 (frontend): Node + npm → frontend/dist
#   Stage 2 (backend):  Go         → /out/mailtrap-local
#   Stage 3 (runtime):  distroless static — no shell, no libc, ~5 MB.
#
# Default ports:
#   3550 — HTTP + SPA + JSON API
#   3535 — SMTP listener
#
# Default DB path is /var/lib/mailtrap-local/db.sqlite3. Mount a volume
# at /var/lib/mailtrap-local to persist messages across restarts.

# ----- Stage 1: frontend bundle --------------------------------------------
FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend

# Cache npm install on package*.json only — code changes don't bust it.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ----- Stage 2: Go binary --------------------------------------------------
FROM golang:1.26-bookworm AS backend
WORKDIR /src

# Module cache layer.
COPY go.mod go.sum ./
RUN go mod download

# Source. Skip frontend/ — we pull dist/ from the frontend stage instead.
COPY cmd/        ./cmd/
COPY internal/   ./internal/
COPY docs/       ./docs/

# Stage embed inputs next to main.go (//go:embed can't traverse `..`).
COPY --from=frontend /src/frontend/dist ./cmd/mailtrap-local/dist
RUN cp docs/api/openapi.yaml cmd/mailtrap-local/openapi.yaml

# Static binary. CGO_ENABLED=0 because modernc.org/sqlite is pure Go.
RUN CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" \
    -o /out/mailtrap-local ./cmd/mailtrap-local

# distroless lacks `mkdir`, so create the data dir owned by nonroot here
# and copy it in. UID/GID 65532 = `nonroot` in distroless images.
RUN mkdir -p /data-empty && chown -R 65532:65532 /data-empty

# ----- Stage 3: runtime ----------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

COPY --from=backend /out/mailtrap-local /usr/local/bin/mailtrap-local
COPY --from=backend --chown=nonroot:nonroot /data-empty /var/lib/mailtrap-local
VOLUME ["/var/lib/mailtrap-local"]

# Keep the at-rest encryption key on the persisted volume. By default the
# binary writes it under $XDG_CONFIG_HOME (~/.config), which is the
# container's ephemeral filesystem — so recreating the container (e.g. a
# `docker pull` upgrade) would generate a fresh key that can't decrypt the
# relay/cloud/webhook credentials already stored in the DB on the volume,
# silently breaking every saved connection. Pinning the key onto the same
# volume as the DB keeps them in lockstep across container recreation.
# (This co-locates key + DB, which the secrets package already documents
# as acceptable for this localhost tool.)
ENV MAILTRAP_LOCAL_SECRET_KEY_FILE=/var/lib/mailtrap-local/secret.key

EXPOSE 3550 3535
USER nonroot:nonroot

ENTRYPOINT ["/usr/local/bin/mailtrap-local"]
# --unsafe-non-loopback is required because we bind 0.0.0.0 inside the
# container: the binary refuses non-loopback binds without it. Safe here —
# the container's network namespace is isolated, and host exposure is
# governed by the operator's `docker run -p` mapping, not by this bind.
CMD ["--unsafe-non-loopback", \
     "--http-listen", "0.0.0.0:3550", \
     "--smtp-listen", "0.0.0.0:3535", \
     "--db", "/var/lib/mailtrap-local/db.sqlite3"]
