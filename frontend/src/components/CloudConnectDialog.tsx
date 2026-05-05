import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useCloudConnection } from '../hooks/useCloudConnection'
import { parseSandboxId } from '../api/cloud'
import type { CloudConfigKey } from '../api/cloud'
import { ExternalLinkIcon } from './icons'
import { Toggle } from './Toggle'
import { extractApiError } from '../api/client'
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

export default function CloudConnectDialog({ open, onOpenChange }: Props) {
  const { state, update, disconnect } = useCloudConnection()
  const isConnected = state?.connected === true
  const lockedKeys: Record<CloudConfigKey, boolean> = state?.locked ?? {
    api_token: false,
    sandbox_id: false,
    mirror_enabled: false,
  }
  const isLocked = (k: CloudConfigKey) => Boolean(lockedKeys[k])
  const allLocked = (
    Object.keys(lockedKeys) as CloudConfigKey[]
  ).every((k) => lockedKeys[k])
  const anyLocked = (
    Object.keys(lockedKeys) as CloudConfigKey[]
  ).some((k) => lockedKeys[k])

  const [apiToken, setApiToken] = useState('')
  const [sandboxInput, setSandboxInput] = useState('')
  const [mirror, setMirror] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form whenever the dialog opens or the underlying connection changes.
  useEffect(() => {
    if (!open) return
    setError(null)
    setApiToken('')
    setSandboxInput(state?.sandbox_id ? String(state.sandbox_id) : '')
    setMirror(state?.mirror_enabled === true)
  }, [open, state])

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
      if (!isLocked('api_token') && apiToken.trim()) body.api_token = apiToken.trim()
      if (!isLocked('sandbox_id') && parsedSandboxId !== null) body.sandbox_id = parsedSandboxId
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

  const sandboxUrl = parsedSandboxId
    ? `https://mailtrap.io/sandboxes/${parsedSandboxId}`
    : null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={content} aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2>Connect to Mailtrap Sandbox</h2>
          </Dialog.Title>
          <p className="lead">
            Link this local sandbox to a Mailtrap cloud sandbox. All incoming emails can
            be mirrored, or forwarded one-by-one from the message view.
          </p>

          {error && <div className={errorBox}>{error}</div>}

          {anyLocked && state?.config_path && (
            <div className={configBanner}>
              {allLocked ? 'All settings are pinned by ' : 'Some settings are pinned by '}
              <code>{state.config_path}</code>. Edit that file and restart to
              change them.
            </div>
          )}

          <div className={field}>
            <label htmlFor="api-token">API token</label>
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
              className={isLocked('api_token') ? lockedInput : undefined}
            />
            {isLocked('api_token') ? (
              <LockedFieldHint path={state?.config_path ?? null} />
            ) : (
              <span className="hint">
                Create one at{' '}
                <a
                  href="https://mailtrap.io/account/api-tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  mailtrap.io/account/api-tokens
                </a>
                .
              </span>
            )}
          </div>

          <div className={field}>
            <label htmlFor="sandbox-id">Sandbox ID</label>
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
              className={isLocked('sandbox_id') ? lockedInput : undefined}
            />
            {isLocked('sandbox_id') ? (
              <LockedFieldHint path={state?.config_path ?? null} />
            ) : sandboxUrl ? (
              <a
                className="hint"
                href={sandboxUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#4c83ee', textDecoration: 'none' }}
              >
                {sandboxUrl} <ExternalLinkIcon size={11} />
              </a>
            ) : (
              <span className="hint">
                Enter the numeric ID from your sandbox URL (
                <code style={{ color: '#4c83ee' }}>
                  mailtrap.io/sandboxes/<b>ID</b>
                </code>
                ).
              </span>
            )}
          </div>

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

          <div className={actions}>
            {isConnected && (
              <button
                type="button"
                className={btn}
                data-variant="danger-text"
                onClick={handleDisconnect}
                disabled={busy}
              >
                Disconnect
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
                {isConnected ? 'Save' : 'Connect'}
              </button>
            )}
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
