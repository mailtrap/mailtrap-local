import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { css } from '@linaria/core'
import { useRelayConnection } from '../hooks/useRelayConnection'
import { Toggle } from './Toggle'
import { extractApiError } from '../api/client'
import { testRelayConnection } from '../api/relay'
import type { RelayConfigKey, RelayConnection } from '../api/relay'
import { LockedFieldHint } from './LockedFieldHint'
import { danger, success, textMuted } from '../styles/tokens'
import {
  actions,
  btn,
  configBanner,
  content,
  errorBox,
  field,
  fieldRow,
  lockedInput,
  overlay,
  toggleDesc,
  toggleRow,
} from './dialogStyles'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const advancedSection = css`
  margin-top: 4px;
  border-top: 1px solid ${textMuted}33;
  padding-top: 12px;

  > summary {
    cursor: pointer;
    list-style: none;
    font-size: 13px;
    font-weight: 500;
    color: ${textMuted};
    padding: 2px 0;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 6px;

    &::-webkit-details-marker {
      display: none;
    }
    /* Disclosure marker on the RIGHT, sized to match the dropdown +
       select chevrons elsewhere. The icon mirrors components/icons.tsx
       ChevronDownIcon at 14px — closed = rotated to point right,
       opens to its natural down orientation when [open]. */
    &::after {
      content: '';
      margin-left: auto;
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16' fill='%238b9aae'><path fill-rule='evenodd' d='M3.22 5.97a.75.75 0 0 1 1.06 0L8 9.69l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.03a.75.75 0 0 1 0-1.06Z' clip-rule='evenodd'/></svg>");
      background-repeat: no-repeat;
      background-position: center;
      transform: rotate(-90deg);
      transition: transform 120ms ease;
    }
  }
  &[open] > summary::after {
    transform: rotate(0deg);
  }
  > summary:hover {
    color: ${textMuted};
    opacity: 0.85;
  }
  > div.body {
    padding-top: 12px;
  }
`

const statusRow = css`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin: 4px 0 8px;
  min-height: 18px;
  color: ${textMuted};

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  &[data-status='ok'] .dot {
    background: ${success};
  }
  &[data-status='error'] .dot {
    background: ${danger};
  }
  &[data-status='testing'] .dot {
    background: ${textMuted};
    animation: pulse 1.2s ease-in-out infinite;
  }
  &[data-status='ok'] {
    color: ${success};
  }
  &[data-status='error'] {
    color: ${danger};
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
`

const TLS_OPTIONS: Array<{ value: RelayConnection['tls']; label: string }> = [
  { value: 'auto', label: 'STARTTLS (recommended)' },
  { value: 'ssl', label: 'Implicit TLS (port 465-style)' },
  { value: 'off', label: 'No TLS' },
]

const AUTH_OPTIONS: Array<{ value: RelayConnection['auth']; label: string }> = [
  { value: 'plain', label: 'PLAIN' },
  { value: 'login', label: 'LOGIN' },
  { value: 'cram_md5', label: 'CRAM-MD5' },
]

export default function RelayConnectDialog({ open, onOpenChange }: Props) {
  const { state, update, disconnect } = useRelayConnection()
  const isConfigured = state?.connected === true
  const lockedKeys: Record<RelayConfigKey, boolean> = state?.locked ?? {
    host: false,
    port: false,
    username: false,
    password: false,
    auth: false,
    tls: false,
    auto_relay_enabled: false,
    override_from: false,
    return_path: false,
  }
  const isLocked = (k: RelayConfigKey) => Boolean(lockedKeys[k])
  const allLocked = (
    Object.keys(lockedKeys) as RelayConfigKey[]
  ).every((k) => lockedKeys[k])
  const anyLocked = (
    Object.keys(lockedKeys) as RelayConfigKey[]
  ).some((k) => lockedKeys[k])

  const [host, setHost] = useState('')
  const [port, setPort] = useState('587')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [auth, setAuth] = useState<RelayConnection['auth']>('plain')
  const [tls, setTls] = useState<RelayConnection['tls']>('auto')
  const [autoRelay, setAutoRelay] = useState(false)
  const [overrideFrom, setOverrideFrom] = useState('')
  const [returnPath, setReturnPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Live connection probe — backend opens a real SMTP handshake against
  // the supplied settings (no message sent) and reports back. Debounced so
  // we don't hammer the server on every keystroke.
  const [testStatus, setTestStatus] = useState<
    'idle' | 'testing' | 'ok' | 'error'
  >('idle')
  const [testMessage, setTestMessage] = useState('')

  // Reset form whenever the dialog opens or the underlying connection changes.
  useEffect(() => {
    if (!open) return
    setError(null)
    setHost(state?.host ?? '')
    setPort(state?.port ? String(state.port) : '587')
    setUsername(state?.username ?? '')
    setPassword('') // never echo; user re-enters or leaves blank to keep
    setAuth(state?.auth ?? 'plain')
    setTls(state?.tls ?? 'auto')
    setAutoRelay(state?.auto_relay_enabled === true)
    setOverrideFrom(state?.override_from ?? '')
    setReturnPath(state?.return_path ?? '')
  }, [open, state])

  const portNum = Number.parseInt(port, 10)
  const canSave =
    !busy && host.trim().length > 0 && Number.isFinite(portNum) && portNum > 0

  // Run the SMTP handshake test 600ms after the form settles. Each keystroke
  // resets the timer; only the final settings actually probe the server.
  // Generation counter prevents stale responses from a previous probe from
  // overwriting a newer result.
  const probeGen = useRef(0)
  useEffect(() => {
    if (!open) return
    if (!canSave) {
      setTestStatus('idle')
      setTestMessage('')
      return
    }
    const myGen = ++probeGen.current
    setTestStatus('testing')
    setTestMessage('Testing connection…')
    const timer = window.setTimeout(async () => {
      try {
        const r = await testRelayConnection({
          host: host.trim(),
          port: portNum,
          username: username.trim() || undefined,
          password: password || undefined,
          auth,
          tls,
        })
        if (myGen !== probeGen.current) return
        setTestStatus(r.ok ? 'ok' : 'error')
        setTestMessage(r.ok ? r.message ?? 'Connected' : r.error ?? 'Failed')
      } catch (e) {
        if (myGen !== probeGen.current) return
        setTestStatus('error')
        setTestMessage(extractApiError(e))
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [open, canSave, host, portNum, username, password, auth, tls])

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const body: Parameters<typeof update>[0] = {}
      // Skip locked keys entirely — the backend would reject them, but more
      // importantly the source of truth is the YAML file for those.
      if (!isLocked('host')) body.host = host.trim()
      if (!isLocked('port')) body.port = portNum
      if (!isLocked('auth')) body.auth = auth
      if (!isLocked('tls')) body.tls = tls
      if (!isLocked('auto_relay_enabled')) body.auto_relay_enabled = autoRelay
      // Username: empty → null on backend; explicit value → set
      if (!isLocked('username')) body.username = username.trim()
      // Password: only send when user typed something. Empty input means
      // "keep saved password" (backend leaves password column untouched).
      if (!isLocked('password') && password.length > 0) body.password = password
      // Sender overrides: always send so an empty input clears them.
      if (!isLocked('override_from')) body.override_from = overrideFrom.trim()
      if (!isLocked('return_path')) body.return_path = returnPath.trim()
      await update(body)
      onOpenChange(false)
    } catch (e) {
      setError(extractApiError(e))
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await disconnect()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={content} aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>Configure SMTP Relay</h2>
          </Dialog.Title>
          <p className="lead">
            Forward messages through any SMTP server — your corporate relay,
            a transactional provider (e.g.{' '}
            <a
              href="https://mailtrap.io/email-sending/"
              target="_blank"
              rel="noreferrer"
              style={{ color: '#4c83ee', textDecoration: 'none' }}
            >
              Mailtrap
            </a>
            ), or another local email sandbox. Per-message forward is
            always available; "auto-relay" mirrors every new email
            automatically (parallel to cloud mirror mode).
          </p>

          {error && <div className={errorBox}>{error}</div>}

          {anyLocked && state?.config_path && (
            <div className={configBanner}>
              {allLocked ? 'All settings are pinned by ' : 'Some settings are pinned by '}
              <code>{state.config_path}</code>. Edit that file and restart to
              change them.
            </div>
          )}

          <div className={fieldRow}>
            <div className={field}>
              <label htmlFor="relay-host">Host</label>
              <input
                id="relay-host"
                type="text"
                autoComplete="off"
                placeholder="smtp.example.com"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                disabled={busy || isLocked('host')}
                readOnly={isLocked('host')}
                className={isLocked('host') ? lockedInput : undefined}
              />
              {isLocked('host') && <LockedFieldHint path={state?.config_path ?? null} />}
            </div>
            <div className={field}>
              <label htmlFor="relay-port">Port</label>
              <input
                id="relay-port"
                type="number"
                inputMode="numeric"
                placeholder="587"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                disabled={busy || isLocked('port')}
                readOnly={isLocked('port')}
                className={isLocked('port') ? lockedInput : undefined}
              />
              {isLocked('port') && <LockedFieldHint path={state?.config_path ?? null} />}
            </div>
          </div>

          <div className={field}>
            <label htmlFor="relay-username">Username (optional)</label>
            <input
              id="relay-username"
              type="text"
              autoComplete="off"
              placeholder="apikey"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy || isLocked('username')}
              readOnly={isLocked('username')}
              className={isLocked('username') ? lockedInput : undefined}
            />
            {isLocked('username') && <LockedFieldHint path={state?.config_path ?? null} />}
          </div>

          <div className={field}>
            <label htmlFor="relay-password">Password</label>
            <input
              id="relay-password"
              type="password"
              autoComplete="off"
              placeholder={
                isLocked('password')
                  ? state?.password_hint ?? 'from config'
                  : isConfigured && state?.password_hint
                    ? `Saved (${state.password_hint}) — leave blank to keep`
                    : 'SMTP password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy || isLocked('password')}
              readOnly={isLocked('password')}
              className={isLocked('password') ? lockedInput : undefined}
            />
            {isLocked('password') && <LockedFieldHint path={state?.config_path ?? null} />}
          </div>

          <div className={fieldRow}>
            <div className={field}>
              <label htmlFor="relay-tls">TLS</label>
              <select
                id="relay-tls"
                value={tls}
                onChange={(e) => setTls(e.target.value as RelayConnection['tls'])}
                disabled={busy || isLocked('tls')}
                className={isLocked('tls') ? lockedInput : undefined}
              >
                {TLS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {isLocked('tls') && <LockedFieldHint path={state?.config_path ?? null} />}
            </div>
            <div className={field}>
              <label htmlFor="relay-auth">Auth method</label>
              <select
                id="relay-auth"
                value={auth}
                onChange={(e) => setAuth(e.target.value as RelayConnection['auth'])}
                disabled={busy || isLocked('auth')}
                className={isLocked('auth') ? lockedInput : undefined}
              >
                {AUTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {isLocked('auth') && <LockedFieldHint path={state?.config_path ?? null} />}
            </div>
          </div>

          <div className={toggleRow}>
            <Toggle
              id="relay-auto"
              label="Auto-relay every incoming email"
              checked={autoRelay}
              onChange={(e) => setAutoRelay(e.target.checked)}
              disabled={busy || isLocked('auto_relay_enabled')}
            />
            {isLocked('auto_relay_enabled') && (
              <LockedFieldHint path={state?.config_path ?? null} />
            )}
          </div>
          <div className={toggleDesc}>
            When on, every new email is also delivered through this SMTP server
            (preserving the original To). When off, forward one at a time from
            the message view.
          </div>

          <details
            className={advancedSection}
            open={
              overrideFrom.length > 0 ||
              returnPath.length > 0 ||
              isLocked('override_from') ||
              isLocked('return_path')
            }
          >
            <summary>Advanced — sender overrides</summary>
            <div className="body">
              <div className={field}>
                <label htmlFor="relay-override-from">Override From</label>
                <input
                  id="relay-override-from"
                  type="email"
                  autoComplete="off"
                  placeholder="welcome@yourdomain.com"
                  value={overrideFrom}
                  onChange={(e) => setOverrideFrom(e.target.value)}
                  disabled={busy || isLocked('override_from')}
                  readOnly={isLocked('override_from')}
                  className={isLocked('override_from') ? lockedInput : undefined}
                />
                {isLocked('override_from') ? (
                  <LockedFieldHint path={state?.config_path ?? null} />
                ) : (
                  <span className="hint">
                    Rewrites the From: header on every relayed message. Required by
                    providers that only allow verified sender domains (Mailtrap
                    live, SendGrid, SES). Original sender is preserved in
                    <code> X-Original-From</code>.
                  </span>
                )}
              </div>

              <div className={field}>
                <label htmlFor="relay-return-path">Return-Path (envelope sender)</label>
                <input
                  id="relay-return-path"
                  type="email"
                  autoComplete="off"
                  placeholder="bounces@yourdomain.com"
                  value={returnPath}
                  onChange={(e) => setReturnPath(e.target.value)}
                  disabled={busy || isLocked('return_path')}
                  readOnly={isLocked('return_path')}
                  className={isLocked('return_path') ? lockedInput : undefined}
                />
                {isLocked('return_path') ? (
                  <LockedFieldHint path={state?.config_path ?? null} />
                ) : (
                  <span className="hint">
                    Sets the SMTP MAIL FROM. Useful when the relay or recipient
                    validates the bounce address (Gmail, large ISPs).
                  </span>
                )}
              </div>
            </div>
          </details>

          <div className={statusRow} data-status={testStatus}>
            {testStatus !== 'idle' && (
              <>
                <span className="dot" />
                <span>{testMessage}</span>
              </>
            )}
          </div>

          <div className={actions}>
            {isConfigured && (
              <button
                type="button"
                className={btn}
                data-variant="danger-text"
                onClick={handleDisconnect}
                disabled={busy}
              >
                Remove
              </button>
            )}
            <button
              type="button"
              className={btn}
              data-variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </button>
            {!allLocked && (
              <button
                type="button"
                className={btn}
                data-variant="primary"
                onClick={handleSave}
                disabled={!canSave}
              >
                {isConfigured ? 'Save' : 'Configure'}
              </button>
            )}
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
