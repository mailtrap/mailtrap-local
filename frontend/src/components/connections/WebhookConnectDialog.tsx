import { useRef, useState } from 'react'
import { useWebhookConnection } from '../../hooks/useWebhookConnection'
import { Toggle } from '../ui/Toggle'
import { extractApiError } from '../../api/client'
import { testWebhookConnection } from '../../api/webhook'
import type { WebhookConfigKey } from '../../api/webhook'
import {
  ConnectionDialogShell,
  DialogActions,
  DialogButton,
  DialogConfigBanner,
  DialogField,
  DialogStatusRow,
  type DialogStatus,
} from './dialogAtoms'
import { LockedFieldHint } from './LockedFieldHint'
import { errorBox, toggleDesc, toggleRow } from './dialogStyles'
import { lockedFields } from './lockedFields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function WebhookConnectDialog({ open, onOpenChange }: Props) {
  return (
    <ConnectionDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Configure Webhook"
      lead="POST every newly-captured email to a URL you control — for CI tests, local automation, or piping into another tool. Payload mirrors the inbox API; signed with HMAC-SHA256 when a shared secret is set."
    >
      <Body onOpenChange={onOpenChange} />
    </ConnectionDialogShell>
  )
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { state, update, disconnect } = useWebhookConnection()
  const isConfigured = state?.connected === true
  const { isLocked, allLocked, anyLocked, inputClass } = lockedFields<
    WebhookConfigKey
  >(state?.locked, {
    url: false,
    secret: false,
    enabled: false,
  })

  const [url, setUrl] = useState(state?.url ?? '')
  const [secret, setSecret] = useState('') // never echo
  const [enabled, setEnabled] = useState(state?.enabled === true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<DialogStatus>('idle')
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

      <DialogField label="URL" htmlFor="webhook-url" locked={isLocked('url')} configPath={state?.config_path}>
        <input
          id="webhook-url"
          type="url"
          autoComplete="off"
          placeholder="https://example.com/hooks/mailtrap-local"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy || isLocked('url')}
          readOnly={isLocked('url')}
          className={
            inputClass('url')
          }
        />
      </DialogField>

      <DialogField
        label="Secret (optional)"
        htmlFor="webhook-secret"
        locked={isLocked('secret')}
        configPath={state?.config_path}
        hint={
          <>
            When set, requests carry{' '}
            <code>X-Mailtrap-Local-Signature: sha256=&lt;hex&gt;</code>. Verify
            by recomputing HMAC-SHA256 over the raw body.
          </>
        }
      >
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
          className={
            inputClass('secret')
          }
        />
      </DialogField>

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
        Off ships nothing — useful while you wire up the receiver. Use "Send
        test" below to verify the URL without sending real mail.
      </div>

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
        <DialogButton variant="outline" onClick={handleTest} disabled={!canTest}>
          Send test
        </DialogButton>
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
