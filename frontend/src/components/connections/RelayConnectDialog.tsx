import { useEffect, useRef, useState } from 'react'
import { useRelayConnection } from '../../hooks/useRelayConnection'
import { Toggle } from '../ui/Toggle'
import { extractApiError } from '../../api/client'
import { testRelayConnection } from '../../api/relay'
import type { RelayConfigKey, RelayConnection } from '../../api/relay'
import { LockedFieldHint } from './LockedFieldHint'
import {
  ConnectionDialogShell,
  DialogActions,
  DialogButton,
  DialogConfigBanner,
  DialogField,
  DialogStatusRow,
  type DialogStatus,
} from './dialogAtoms'
import {
  errorBox,
  fieldRow,
  toggleDesc,
  toggleRow,
} from './dialogStyles'
import { lockedFields } from './lockedFields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Collapsible "Advanced — sender overrides" block. Disclosure chevron
// + summary styling come from `.disclosure-section` in index.css; the
// inner .body div carries its own top padding directly.
const advancedSectionCss =
  'disclosure-section mt-1 border-t border-fg-muted/20 pt-3'

const advancedSectionBodyCss = 'pt-3'

const TLS_OPTIONS: Array<{ value: RelayConnection['tls']; label: string }> = [
  { value: 'auto', label: 'STARTTLS (recommended)' },
  { value: 'ssl', label: 'Implicit TLS (port 465-style)' },
  { value: 'off', label: 'No TLS' },
]

const AUTH_OPTIONS: Array<{ value: RelayConnection['auth']; label: string }> = [
  { value: 'plain', label: 'PLAIN' },
  { value: 'none', label: 'None' },
]

export function RelayConnectDialog({ open, onOpenChange }: Props) {
  return (
    <ConnectionDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Configure SMTP Relay"
      lead={
        <>
          Forward messages through any SMTP server — your corporate relay, a
          transactional provider (e.g.{' '}
          <a
            href="https://mailtrap.io/email-sending/"
            target="_blank"
            rel="noreferrer"
            className="text-accent no-underline"
          >
            Mailtrap
          </a>
          ), or another local email sandbox. Per-message forward is always
          available; "auto-relay" mirrors every new email automatically
          (parallel to cloud mirror mode).
        </>
      }
    >
      <Body onOpenChange={onOpenChange} />
    </ConnectionDialogShell>
  )
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { state, update, disconnect } = useRelayConnection()
  const isConfigured = state?.connected === true
  const { isLocked, allLocked, anyLocked, inputClass, selectClass } =
    lockedFields<RelayConfigKey>(state?.locked, {
    host: false,
    port: false,
    username: false,
    password: false,
    auth: false,
    tls: false,
    auto_relay_enabled: false,
    override_from: false,
    return_path: false,
  })

  const [host, setHost] = useState(state?.host ?? '')
  const [port, setPort] = useState(state?.port ? String(state.port) : '587')
  const [username, setUsername] = useState(state?.username ?? '')
  const [password, setPassword] = useState('') // never echo
  const [auth, setAuth] = useState<RelayConnection['auth']>(
    state?.auth ?? 'plain',
  )
  const [tls, setTls] = useState<RelayConnection['tls']>(state?.tls ?? 'auto')
  const [autoRelay, setAutoRelay] = useState(
    state?.auto_relay_enabled === true,
  )
  const [overrideFrom, setOverrideFrom] = useState(state?.override_from ?? '')
  const [returnPath, setReturnPath] = useState(state?.return_path ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Live connection probe — backend opens a real SMTP handshake against
  // the supplied settings (no message sent) and reports back. Debounced so
  // we don't hammer the server on every keystroke.
  const [testStatus, setTestStatus] = useState<DialogStatus>('idle')
  const [testMessage, setTestMessage] = useState('')

  const portNum = Number.parseInt(port, 10)
  const canSave =
    !busy && host.trim().length > 0 && Number.isFinite(portNum) && portNum > 0

  // Run the SMTP handshake test 600ms after the form settles. Each keystroke
  // resets the timer; only the final settings actually probe the server.
  // Generation counter prevents stale responses from a previous probe from
  // overwriting a newer result.
  //
  // The setState calls below are inside a useEffect, which the
  // react-hooks/set-state-in-effect rule warns on. Debounced async
  // probe with a status indicator is exactly what the pattern's for —
  // we accept the warning rather than refactor.
  const probeGen = useRef(0)
  useEffect(() => {
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
  }, [canSave, host, portNum, username, password, auth, tls])

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
      if (!isLocked('password') && password.length > 0)
        body.password = password
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
      setError(extractApiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <div className={errorBox}>{error}</div>}

      {anyLocked && state?.config_path && (
        <DialogConfigBanner
          allLocked={allLocked}
          configPath={state.config_path}
        />
      )}

      <div className={fieldRow}>
        <DialogField
          label="Host"
          htmlFor="relay-host"
          locked={isLocked('host')}
          configPath={state?.config_path}
        >
          <input
            id="relay-host"
            type="text"
            autoComplete="off"
            placeholder="smtp.example.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={busy || isLocked('host')}
            readOnly={isLocked('host')}
            className={
              inputClass('host')
            }
          />
        </DialogField>
        <DialogField
          label="Port"
          htmlFor="relay-port"
          locked={isLocked('port')}
          configPath={state?.config_path}
        >
          <input
            id="relay-port"
            type="number"
            inputMode="numeric"
            placeholder="587"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={busy || isLocked('port')}
            readOnly={isLocked('port')}
            className={
              inputClass('port')
            }
          />
        </DialogField>
      </div>

      <DialogField
        label="Username (optional)"
        htmlFor="relay-username"
        locked={isLocked('username')}
        configPath={state?.config_path}
      >
        <input
          id="relay-username"
          type="text"
          autoComplete="off"
          placeholder="apikey"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={busy || isLocked('username')}
          readOnly={isLocked('username')}
          className={
            inputClass('username')
          }
        />
      </DialogField>

      <DialogField
        label="Password"
        htmlFor="relay-password"
        locked={isLocked('password')}
        configPath={state?.config_path}
      >
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
          className={
            inputClass('password')
          }
        />
      </DialogField>

      <div className={fieldRow}>
        <DialogField
          label="TLS"
          htmlFor="relay-tls"
          locked={isLocked('tls')}
          configPath={state?.config_path}
        >
          <select
            id="relay-tls"
            value={tls}
            onChange={(e) => setTls(e.target.value as RelayConnection['tls'])}
            disabled={busy || isLocked('tls')}
            className={
              selectClass('tls')
            }
          >
            {TLS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogField
          label="Auth method"
          htmlFor="relay-auth"
          locked={isLocked('auth')}
          configPath={state?.config_path}
        >
          <select
            id="relay-auth"
            value={auth}
            onChange={(e) => setAuth(e.target.value as RelayConnection['auth'])}
            disabled={busy || isLocked('auth')}
            className={
              selectClass('auth')
            }
          >
            {AUTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </DialogField>
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
        (preserving the original To). When off, forward one at a time from the
        message view.
      </div>

      <details
        className={advancedSectionCss}
        open={
          overrideFrom.length > 0 ||
          returnPath.length > 0 ||
          isLocked('override_from') ||
          isLocked('return_path')
        }
      >
        <summary>Advanced — sender overrides</summary>
        <div className={advancedSectionBodyCss}>
          <DialogField
            label="Override From"
            htmlFor="relay-override-from"
            locked={isLocked('override_from')}
            configPath={state?.config_path}
            hint={
              <>
                Rewrites the From: header on every relayed message. Required
                by providers that only allow verified sender domains (Mailtrap
                live, SendGrid, SES). Original sender is preserved in
                <code> X-Original-From</code>.
              </>
            }
          >
            <input
              id="relay-override-from"
              type="email"
              autoComplete="off"
              placeholder="welcome@yourdomain.com"
              value={overrideFrom}
              onChange={(e) => setOverrideFrom(e.target.value)}
              disabled={busy || isLocked('override_from')}
              readOnly={isLocked('override_from')}
              className={inputClass('override_from')}
            />
          </DialogField>

          <DialogField
            label="Return-Path (envelope sender)"
            htmlFor="relay-return-path"
            locked={isLocked('return_path')}
            configPath={state?.config_path}
            hint={
              <>
                Sets the SMTP MAIL FROM. Useful when the relay or recipient
                validates the bounce address (Gmail, large ISPs).
              </>
            }
          >
            <input
              id="relay-return-path"
              type="email"
              autoComplete="off"
              placeholder="bounces@yourdomain.com"
              value={returnPath}
              onChange={(e) => setReturnPath(e.target.value)}
              disabled={busy || isLocked('return_path')}
              readOnly={isLocked('return_path')}
              className={inputClass('return_path')}
            />
          </DialogField>
        </div>
      </details>

      <DialogStatusRow status={testStatus} message={testMessage} />

      <DialogActions>
        {isConfigured && (
          <DialogButton
            variant="danger-text"
            onClick={handleDisconnect}
            disabled={busy}
          >
            Remove
          </DialogButton>
        )}
        <DialogButton
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={busy}
        >
          Cancel
        </DialogButton>
        {!allLocked && (
          <DialogButton
            variant="primary"
            onClick={handleSave}
            disabled={!canSave}
          >
            {isConfigured ? 'Save' : 'Configure'}
          </DialogButton>
        )}
      </DialogActions>
    </>
  )
}
