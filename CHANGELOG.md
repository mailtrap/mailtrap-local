# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-06

### Added

- Nix package via NUR (`nix run github:mailtrap/mailtrap-nur#mailtrap-local`); goreleaser opens a PR on each tag

### Fixed

- Release Docker image seeds nonroot-owned `/var/lib/mailtrap-local` so named/anonymous volume mounts can open SQLite

### Changed

- Docs prefer Docker Hub (`mailtrap/mailtrap-local`) over GHCR
- Homebrew install docs include formula trust step for Homebrew 6
- Release job fails if expected Homebrew or NUR package PRs are missing

## [0.2.0] - 2026-07-22

### Added

- Sidebar message list infinite-scroll pagination; live updates keep page consistent
- Attachments UI aligned with Mailtrap sandbox (file chips + disclosure behavior)
- Accessible Tech Info tooltips (Radix)

### Fixed

- Inline `cid:` images resolve safely in HTML preview (URL-context only)
- Friendly empty state when the open message was deleted
- Connection dialogs scroll/usable on short viewports
- UI polish: alignment, scrollbar theming, toggle/label alignment, sandbox link row

### Changed

- Goreleaser opens a Homebrew formula PR on `mailtrap/homebrew-local` (main requires PRs)

## [0.1.0] - 2026-07-03

Initial public release of Mailtrap Local — a local email sandbox and catcher for individual developers.

### Added

- Single self-contained binary (Go) with embedded React web UI, SMTP listener, and JSON REST API
- Local SMTP server on `127.0.0.1:3535` to catch outbound mail from any app
- Web sandbox on `127.0.0.1:3550` — browse, search, and inspect messages (HTML, text, raw, headers, attachments)
- REST API at `/api/v1/*` with OpenAPI spec
- HTML email client-compatibility check (HTML Check) powered by caniemail.com data
- Message categories, manual release to a generic SMTP relay, and outbound webhooks (HMAC-SHA256)
- Optional forwarding to Mailtrap cloud sandbox (`send_to_cloud`)
- Real-time inbox updates via WebSocket (`/cable`)
- Sendmail-replacement mode (`sendmail`, `mailtrap-sendmail`, or `mailtrap-local sendmail`)
- YAML config overlay for pinning connection settings
- Distribution via Homebrew tap, Docker (Docker Hub + GHCR), and GitHub Releases binaries (macOS + Linux)

[0.3.0]: https://github.com/mailtrap/mailtrap-local/releases/tag/v0.3.0
[0.2.0]: https://github.com/mailtrap/mailtrap-local/releases/tag/v0.2.0
[0.1.0]: https://github.com/mailtrap/mailtrap-local/releases/tag/v0.1.0
