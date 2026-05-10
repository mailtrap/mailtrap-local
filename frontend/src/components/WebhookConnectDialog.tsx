import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useWebhookConnection } from '../hooks/useWebhookConnection'
import { Toggle } from './Toggle'
import { extractApiError } from '../api/client'
import { testWebhookConnection } from '../api/webhook'
import type { WebhookConfigKey } from '../api/webhook'
import { LockedFieldHint } from './LockedFieldHint'
import {
  actions,
  btn,
  configBanner,
  content,
  errorBox,
  field,
  lockedInput,
  overlay,
  toggleDesc,
  toggleRow,
} from './dialogStyles'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Same status-row pattern as RelayConnectDialog. Pulse animation comes
// from `.pulse-dot` in index.css.
const statusRow = [
  'flex min-h-[18px] items-center gap-2 mt-1 mb-2 text-xs text-fg-muted',
  '[&_.dot]:inline-block [&_.dot]:h-2 [&_.dot]:w-2 [&_.dot]:shrink-0 [&_.dot]:rounded-full',
  'data-[status=ok]:text-success [&[data-status=ok]_.dot]:bg-success',
  'data-[status=error]:text-danger [&[data-status=error]_.dot]:bg-danger',
  '[&[data-status=testing]_.dot]:bg-fg-muted [&[data-status=testing]_.dot]:pulse-dot',
].join(' ')

/**
 * Outer wrapper. The actual form is in <Body>, mounted only when
 * `open=true`. Each open ⇒ fresh useState initialisers ⇒ form fields
 * sync with the current connection state without a reset-effect.
 */
export default function WebhookConnectDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={content} aria-describedby={undefined}>
          {open && <Body onOpenChange={onOpenChange} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { state, update, disconnect } = useWebhookConnection()
  const isConfigured = state?.connected === true
  const lockedKeys: Record<WebhookConfigKey, boolean> = state?.locked ?? {
    url: false,
    secret: false,
    enabled: false,
  }
  const isLocked = (k: WebhookConfigKey) => Boolean(lockedKeys[k])
  const allLocked = (Object.keys(lockedKeys) as WebhookConfigKey[]).every(
    (k) => lockedKeys[k],
  )
  const anyLocked = (Object.keys(lockedKeys) as WebhookConfigKey[]).some(
    (k) => lockedKeys[k],
  )

  // Initial values pulled directly from `state` — runs once at mount,
  // discarded on close.
  const [url, setUrl] = useState(state?.url ?? '')
  const [secret, setSecret] = useState('') // never echo
  const [enabled, setEnabled] = useState(state?.enabled === true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<
    'idle' | 'testing' | 'ok' | 'error'
  >('idle')
  const [testMessage, setTestMessage] = useState('')

  const isHttpUrl = /^https?:\/\//i.test(url.trim())
  const canSave = !busy && isHttpUrl
  const canTest = isHttpUrl && !busy

  // Manual test — webhooks side-effect on the receiver, so unlike the SMTP
  // relay we don't fire on every keystroke. The user explicitly clicks
  // "Send test" and we POST a synthetic ping.
  const probeGen = useRef(0)
  const handleTest = async () => {
    if (!canTest) return
    const myGen = ++probeGen.current
    setTestStatus('testing')
    setTestMessage('Sending test ping…')
    try {
      const r = await testWebhookConnection({
        url: url.trim(),
        secret: secret || undefined,
      })
      if (myGen !== probeGen.current) return
      setTestStatus(r.ok ? 'ok' : 'error')
      setTestMessage(r.ok ? r.message ?? 'Delivered' : r.error ?? 'Failed')
    } catch (e) {
      if (myGen !== probeGen.current) return
      setTestStatus('error')
      setTestMessage(extractApiError(e))
    }
  }

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const body: Parameters<typeof update>[0] = {}
      if (!isLocked('url')) body.url = url.trim()
      if (!isLocked('enabled')) body.enabled = enabled
      // Secret: only send when typed. Empty input means "keep saved value"
      // — same convention as the relay password and cloud token fields.
      if (!isLocked('secret') && secret.length > 0) body.secret = secret
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
    <>
      <Dialog.Title asChild>
        <h2>Configure Webhook</h2>
      </Dialog.Title>
      <p className="lead">
        POST every newly-captured email to a URL you control — for CI
        tests, local automation, or piping into another tool. Payload
        mirrors the inbox API; signed with HMAC-SHA256 when a shared
        secret is set.
      </p>

      {error && <div className={errorBox}>{error}</div>}

      {anyLocked && state?.config_path && (
        <div className={configBanner}>
          {allLocked
            ? 'All settings are pinned by '
            : 'Some settings are pinned by '}
          <code>{state.config_path}</code>. Edit that file and restart to
          change them.
        </div>
      )}

      <div className={field}>
        <label htmlFor="webhook-url">URL</label>
        <input
          id="webhook-url"
          type="url"
          autoComplete="off"
          placeholder="https://example.com/hooks/mailtrap-local"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy || isLocked('url')}
          readOnly={isLocked('url')}
          className={isLocked('url') ? lockedInput : undefined}
        />
        {isLocked('url') && (
          <LockedFieldHint path={state?.config_path ?? null} />
        )}
      </div>

      <div className={field}>
        <label htmlFor="webhook-secret">Secret (optional)</label>
        <input
          id="webhook-secret"
          type="password"
          autoComplete="off"
          placeholder={
            isLocked('secret')
              ? state?.secret_hint ?? 'from config'
              : isConfigured && state?.secret_hint
                ? `Saved (${state.secret_hint}) — leave blank to keep`
                : 'HMAC-SHA256 signing key'
          }
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={busy || isLocked('secret')}
          readOnly={isLocked('secret')}
          className={isLocked('secret') ? lockedInput : undefined}
        />
        {isLocked('secret') ? (
          <LockedFieldHint path={state?.config_path ?? null} />
        ) : (
          <span className="hint">
            When set, requests carry{' '}
            <code>X-Mailtrap-Local-Signature: sha256=&lt;hex&gt;</code>.
            Verify by recomputing HMAC-SHA256 over the raw body.
          </span>
        )}
      </div>

      <div className={toggleRow}>
        <Toggle
          id="webhook-enabled"
          label="Fire webhook for every new email"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={busy || isLocked('enabled')}
        />
        {isLocked('enabled') && (
          <LockedFieldHint path={state?.config_path ?? null} />
        )}
      </div>
      <div className={toggleDesc}>
        Off ships nothing — useful while you wire up the receiver. Use
        "Send test" below to verify the URL without sending real mail.
      </div>

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
          onClick={handleTest}
          disabled={!canTest}
        >
          Send test
        </button>
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
    </>
  )
}
