# Security Policy

## Security model

`mailtrap-local` is a **local development / CI email sandbox**. It is designed
to run on a developer's machine or inside a CI job, **bound to loopback**
(`127.0.0.1` / `::1`) with **no authentication, no TLS, and no multi-tenancy** —
those are intentionally out of scope (see the README's "What it is *not*").

Because of that, the relevant threat model is narrow:

- **It binds loopback by default.** Binding to a non-loopback interface requires
  the explicit `--unsafe-non-loopback` flag. Do **not** expose the HTTP or SMTP
  port to an untrusted network. If you need network access, put an
  authenticating, TLS-terminating reverse proxy in front of it.
- **Connection test endpoints make outbound requests.** `POST
  /api/v1/relay_connection/test` and `POST /api/v1/webhook_connection/test` open
  TCP connections to hostnames you supply. On loopback this is limited to whoever
  can already reach the local API; if you expose the HTTP port beyond localhost,
  an attacker could use these endpoints for SSRF-style probing from your machine.
- **It renders attacker-controlled content.** Anything that can reach the SMTP
  port can submit arbitrary email, including hostile HTML and attachments. The
  UI renders message HTML inside a sandboxed iframe and serves attachments as
  downloads with `X-Content-Type-Options: nosniff` and a restrictive CSP.
- **Credentials are encrypted at rest as defense in depth, not as a vault.** The
  cloud API token, SMTP relay password, and webhook secret are encrypted
  (AES-256-GCM) with a key stored beside the database. Anyone with read access to
  **both** the key file and the database can still decrypt them — co-locating the
  two is an accepted trade-off for a single-user local tool.

A finding is in scope if it lets someone do something the model above does
**not** already permit — e.g. a cross-origin page reading the local inbox, email
content escaping the preview sandbox into the app origin, or credentials leaking
over the network. "The server has no auth when bound to `0.0.0.0`" is *not* a
vulnerability — that's the documented design, gated behind a flag.

## Supported versions

Only the latest released version receives security fixes. Please reproduce on
the latest release (or `main`) before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub Security Advisories:

<https://github.com/mailtrap/mailtrap-local/security/advisories/new>

You can also use the **"Report a vulnerability"** button on the repository's
**Security** tab. Both open a private channel with the maintainers.

When reporting, please include:

- affected version / commit,
- a description of the issue and its impact,
- steps to reproduce (a minimal example helps), and
- any suggested remediation if you have one.

We aim to acknowledge reports within a few business days and will keep you
updated as we investigate and ship a fix. Coordinated disclosure is appreciated.
