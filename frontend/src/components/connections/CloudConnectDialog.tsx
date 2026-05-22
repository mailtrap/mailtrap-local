import { useState } from 'react'
import { useCloudConnection } from '../../hooks/useCloudConnection'
import { parseSandboxId } from '../../api/cloud'
import type { CloudConfigKey } from '../../api/cloud'
import { ExternalLinkIcon } from '../ui/icons'
import { Toggle } from '../ui/Toggle'
import { extractApiError } from '../../api/client'
import { LockedFieldHint } from './LockedFieldHint'
import {
  ConnectionDialogShell,
  DialogActions,
  DialogButton,
  DialogConfigBanner,
  DialogField,
} from './dialogAtoms'
import {
  errorBox,
  fieldHint,
  fieldHintLink,
  toggleDesc,
  toggleRow,
} from './dialogStyles'
import { lockedFields } from './lockedFields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CloudConnectDialog({ open, onOpenChange }: Props) {
  return (
    <ConnectionDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Connect to Mailtrap Sandbox"
      lead="Link this local sandbox to a Mailtrap cloud sandbox. All incoming emails can be mirrored, or forwarded one-by-one from the message view."
    >
      <Body onOpenChange={onOpenChange} />
    </ConnectionDialogShell>
  )
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { state, update, disconnect } = useCloudConnection()
  const isConnected = state?.connected === true
  const { isLocked, allLocked, anyLocked, inputClass } = lockedFields<
    CloudConfigKey
  >(state?.locked, {
    api_token: false,
    sandbox_id: false,
    mirror_enabled: false,
  })

  const [apiToken, setApiToken] = useState('')
  const [sandboxInput, setSandboxInput] = useState(
    state?.sandbox_id ? String(state.sandbox_id) : '',
  )
  const [mirror, setMirror] = useState(state?.mirror_enabled === true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedSandboxId = parseSandboxId(sandboxInput)
  const canSave =
    !busy &&
    (isConnected
      ? parsedSandboxId !== null // connected: token is optional (kept as-is if not retyped)
      : apiToken.trim().length > 0 && parsedSandboxId !== null)

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const body: Parameters<typeof update>[0] = {}
      if (!isLocked('mirror_enabled')) body.mirror_enabled = mirror
      if (!isLocked('api_token') && apiToken.trim())
        body.api_token = apiToken.trim()
      if (!isLocked('sandbox_id') && parsedSandboxId !== null)
        body.sandbox_id = parsedSandboxId
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

  const sandboxUrl = parsedSandboxId
    ? `https://mailtrap.io/sandboxes/${parsedSandboxId}`
    : null

  return (
    <>
      {error && <div className={errorBox}>{error}</div>}

      {anyLocked && state?.config_path && (
        <DialogConfigBanner
          allLocked={allLocked}
          configPath={state.config_path}
        />
      )}

      <DialogField
        label="API token"
        htmlFor="api-token"
        locked={isLocked('api_token')}
        configPath={state?.config_path}
        hint={
          <>
            Create one at{' '}
            <a
              className={fieldHintLink}
              href="https://mailtrap.io/account/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              mailtrap.io/account/api-tokens
            </a>
            .
          </>
        }
      >
        <input
          id="api-token"
          type="password"
          autoComplete="off"
          placeholder={
            isLocked('api_token')
              ? state?.api_token_hint ?? 'from config'
              : isConnected
                ? `Saved (${state?.api_token_hint ?? '••••'}) — leave blank to keep`
                : 'Paste your Mailtrap API token'
          }
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          disabled={busy || isLocked('api_token')}
          readOnly={isLocked('api_token')}
          className={
            inputClass('api_token')
          }
        />
      </DialogField>

      {/* Sandbox-ID field — the hint slot is unusual: when a sandboxUrl
          is parsed from the input, we render an accent-coloured link
          INSTEAD of the default muted hint. So we don't use the
          DialogField.hint prop and roll the trailing element by hand. */}
      <DialogField
        label="Sandbox ID"
        htmlFor="sandbox-id"
        locked={isLocked('sandbox_id')}
        configPath={state?.config_path}
      >
        <input
          id="sandbox-id"
          type="text"
          autoComplete="off"
          inputMode="numeric"
          placeholder="1847753"
          value={sandboxInput}
          onChange={(e) => setSandboxInput(e.target.value)}
          disabled={busy || isLocked('sandbox_id')}
          readOnly={isLocked('sandbox_id')}
          className={
            inputClass('sandbox_id')
          }
        />
        {!isLocked('sandbox_id') &&
          (sandboxUrl ? (
            <a
              className={`${fieldHint} ${fieldHintLink}`}
              href={sandboxUrl}
              target="_blank"
              rel="noreferrer"
            >
              {sandboxUrl} <ExternalLinkIcon size={11} />
            </a>
          ) : (
            <span className={fieldHint}>
              Enter the numeric ID from your sandbox URL (
              <code className="text-accent">
                mailtrap.io/sandboxes/<b>ID</b>
              </code>
              ).
            </span>
          ))}
      </DialogField>

      <div className={toggleRow}>
        <Toggle
          id="cloud-mirror"
          label="Mirror every incoming email"
          checked={mirror}
          onChange={(e) => setMirror(e.target.checked)}
          disabled={busy || isLocked('mirror_enabled')}
        />
        {isLocked('mirror_enabled') && (
          <LockedFieldHint path={state?.config_path ?? null} />
        )}
      </div>
      <div className={toggleDesc}>
        When on, every new email caught locally is also relayed to the cloud
        sandbox. When off, forward one at a time from the message view.
      </div>

      <DialogActions>
        {isConnected && (
          <DialogButton
            variant="danger-text"
            onClick={handleDisconnect}
            disabled={busy}
          >
            Disconnect
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
            {isConnected ? 'Save' : 'Connect'}
          </DialogButton>
        )}
      </DialogActions>
    </>
  )
}
