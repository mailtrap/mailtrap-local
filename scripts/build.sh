#!/usr/bin/env bash
# Builds the single-binary mailtrap-local.
#
# Steps:
#   1. Build the React SPA (frontend/dist/).
#   2. Stage embed sources next to cmd/mailtrap-local/main.go — Go's
#      //go:embed cannot traverse `..`, so we copy dist/ + openapi.yaml
#      into the same directory as main.go.
#   3. Compile the single Go binary into bin/mailtrap-local.
#
# Env vars:
#   GOOS, GOARCH       — cross-compile targets (passed through to `go build`).
#   SKIP_FRONTEND=1    — reuse the existing cmd/mailtrap-local/dist (CI cache).
#   SKIP_NPM_INSTALL=1 — skip `npm install` (frontend deps already present).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/bin"
EMBED_DIR="$ROOT/cmd/mailtrap-local"

mkdir -p "$OUT_DIR"

# 1. Frontend build
if [[ "${SKIP_FRONTEND:-0}" == "1" ]]; then
  echo "[build] SKIP_FRONTEND=1 — reusing existing $EMBED_DIR/dist"
  if [[ ! -d "$EMBED_DIR/dist" ]]; then
    echo "[build] error: SKIP_FRONTEND set but $EMBED_DIR/dist is missing" >&2
    exit 1
  fi
else
  echo "[build] building frontend"
  pushd "$ROOT/frontend" >/dev/null
  if [[ "${SKIP_NPM_INSTALL:-0}" != "1" ]]; then
    npm install --no-audit --no-fund
  fi
  npm run build
  popd >/dev/null

  echo "[build] staging dist/ into $EMBED_DIR"
  rm -rf "$EMBED_DIR/dist"
  cp -R "$ROOT/frontend/dist" "$EMBED_DIR/dist"
fi

# 2. Stage OpenAPI spec for //go:embed
echo "[build] staging openapi.yaml into $EMBED_DIR"
cp "$ROOT/docs/api/openapi.yaml" "$EMBED_DIR/openapi.yaml"

# 3. Compile single binary
echo "[build] compiling Go binary"
go build -o "$OUT_DIR/mailtrap-local" ./cmd/mailtrap-local

echo "[build] built: $OUT_DIR/mailtrap-local"
