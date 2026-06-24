# Contributing to mailtrap-local

Thanks for your interest! `mailtrap-local` is a single Go binary that embeds a
React SPA — an SMTP catcher + web sandbox + JSON API for local development and
CI. This guide covers how to get set up and what we look for in a change.

## Prerequisites

- **Go 1.26+**
- **Node 22+**
- Optional: `foreman` (for `bin/dev`), and `mise`/`asdf` to install the toolchain
  from `.tool-versions`.

## Getting started

```sh
bin/setup        # go mod download + npm install
bin/dev          # boots backend + Vite concurrently (Procfile.dev)
```

In dev:

| Port   | Served by                | Purpose                              |
|--------|--------------------------|--------------------------------------|
| `3535` | `go run ./cmd/...`       | SMTP ingest                          |
| `3540` | Vite dev                 | SPA (HMR) — proxies `/api` + `/cable` |
| `3550` | Go binary                | JSON API + WebSocket                 |

Open <http://127.0.0.1:3540> for the dev UI. The production single binary serves
the same UI at <http://127.0.0.1:3550> from the embedded `dist/`.

To build the real single binary (frontend + Go embed):

```sh
scripts/build.sh   # → bin/mailtrap-local
```

## Tests

Everything must pass before a PR is merged — CI runs all of this.

```sh
# Go: lint + every package, race detector on (matches CI)
golangci-lint run ./cmd/... ./internal/...
go test -race ./cmd/... ./internal/...

# Frontend (from frontend/)
npm run build    # tsc -b && vite build — catches type + import regressions
npm run lint
npm test         # vitest (jsdom + @testing-library)
```

The **OpenAPI drift test** (`internal/api/openapi_drift_test.go`) fails if a chi
route is added/removed without updating `docs/api/openapi.yaml`. If you change
routes, update **both** `docs/api/openapi.yaml` and the embedded copy at
`cmd/mailtrap-local/openapi.yaml`.

## Code style

- **Go:** `golangci-lint` (see `.golangci.yml`) is enforced in CI. Keep handlers thin; the `internal/`
  packages are split by concern (`api`, `smtpd`, `store`, `jobs`, `relay`,
  `webhook`, `cloud`, `live`, `secrets`, `config`). Prefer `errors.Is`/`errors.As`
  over string matching.
- **Frontend:** TypeScript + React 19 + Tailwind v4. See
  `.claude/skills/frontend-code-style/SKILL.md` for the component/styling
  conventions used here (primitives + shared constants, design tokens via
  `@theme`, adjust-state-during-render over `setState`-in-effect).
- Comments should explain **why**, not what. Match the surrounding style — this
  codebase documents trade-offs and past bugs deliberately; keep that up.

## Pull requests

1. Branch off `main`.
2. Keep PRs focused — one concern per PR. Unrelated cleanups belong in their own
   PR.
3. Add or update tests for behavior changes. Bug fixes should come with a
   regression test.
4. Make sure `golangci-lint`, the full test suite (Go + frontend), and `go vet` pass locally.
5. Write a clear description: what changed, why, and how you verified it.

## Security

Please **do not** file security issues as public issues — see
[SECURITY.md](SECURITY.md) for private reporting.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
