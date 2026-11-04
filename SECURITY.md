# Security Policy

## Security model

`mailtrap-local` is a **local development / CI email sandbox**. It is designed
to run on a developer's machine or inside a CI job, **bound to loopback**
(`127.0.0.1` / `::1`) with **no authentication, no TLS, and no multi-tenancy** —
those are intentionally out of scope (see the README's "What it is *not*").

Because of that, the relevant threat model is narrow:

- **It binds loopback by default.** Binding to a non-loopback interface requires
  the explicit `--unsafe-non-loopback` flag. Do **not** expose the HTTP or SMTP
  port to an untrusted network.
- **It only accepts connections from the same machine.** HTTP and SMTP refuse
  any client whose source address is not loopback, even when bound to a
  non-loopback interface. `--allow-from` admits extra ranges for setups where
  same-machine traffic arrives from another address, and
  `--allow-attached-networks` admits the subnets of the machine's own
  interfaces. The Docker image uses the latter to allow the container's own
  networks, so publish its ports on `127.0.0.1`; with `--network host`,
  macvlan or ipvlan those networks include the LAN. Access from other machines,
  including through a reverse proxy on another host, is not supported.
- **Browser requests must come from this machine's pages.** The HTTP server
  rejects requests whose `Origin` names anything other than `localhost`,
  `*.localhost`, a loopback IP, or a hostname listed in `allowed_hosts` in
  `config.yml`. The `Host` header must be one of those too, or a dotless or
  `*.internal` name, so containers can call the API by Docker Compose
  service name or `host.docker.internal`. This blocks cross-site requests
  and DNS rebinding from websites open in the developer's browser. Those
  two kinds of name don't resolve through public DNS, but an attacker who
  controls name resolution on the local network could still rebind one to
  this machine.
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
**not** already permit — e.g. a cross-origin page reading the local inbox, a
client on another machine getting past the same-machine check, email content
escaping the preview sandbox into the app origin, or credentials leaking over
the network. "The server has no auth when bound to `0.0.0.0`" is *not* a
vulnerability — that's the documented design, gated behind a flag.

## Supported versions

Only the latest released version receives security fixes. Please reproduce on
the latest release (or `main`) before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's **"Report a vulnerability"** button on the
repository's **Security** tab (Security advisories → Report a vulnerability).
This opens a private channel with the maintainers.

<!-- TODO(maintainers): if you prefer email, add a dedicated security contact
     here (e.g. security@yourdomain) and enable "Private vulnerability reporting"
     in the repository's Settings → Security. -->

When reporting, please include:

- affected version / commit,
- a description of the issue and its impact,
- steps to reproduce (a minimal example helps), and
- any suggested remediation if you have one.

We aim to acknowledge reports within a few business days and will keep you
updated as we investigate and ship a fix. Coordinated disclosure is appreciated.
