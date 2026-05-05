# frontend/

React 19 SPA — the mailtrap-local web sandbox.

## Stack

| Layer | Choice |
|---|---|
| Framework | React 19 (TypeScript, `.tsx`) |
| Build | Vite |
| CSS-in-JS | Linaria (`@linaria/core`, `@linaria/react`) via `@wyw-in-js/vite` plugin — zero-runtime CSS extraction |
| A11y primitives | Radix UI (`@radix-ui/react-dialog`, `dropdown-menu`, `tabs`, `tooltip`) |
| Routing | `react-router-dom` v7 |
| HTTP client | `axios` |

## Running

From the repo root:

```
bin/dev          # starts the Go binary + Vite via Procfile.dev (requires foreman)
```

From inside `frontend/` directly:

```
npm install
npm run dev      # Vite dev server on http://127.0.0.1:3540 with HMR
npm run build    # production build to dist/
npm run preview  # serve dist/ on http://127.0.0.1:4173
```

## Backend connection

In dev, Vite proxies `/api` and `/cable` to the Go backend at `http://127.0.0.1:3550`. Override via `VITE_API_TARGET` env var.

In production, the single binary embeds the built `dist/` (`//go:embed`) and serves it from the same origin as the API — no proxy needed.

## Layout

```
frontend/
├── src/
│   ├── api/                     # typed clients per endpoint group
│   ├── components/              # generic UI components
│   ├── hooks/                   # data + behavior hooks (useCloudConnection, etc.)
│   ├── pages/
│   │   ├── Sandbox.tsx          # empty-state landing
│   │   └── MessageView.tsx      # per-message detail
│   ├── styles/tokens.ts         # design tokens (single source of truth)
│   ├── App.tsx                  # top-level routes + shell
│   └── main.tsx                 # entry, BrowserRouter
├── public/
├── vite.config.ts
└── package.json
```
