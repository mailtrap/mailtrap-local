import { useEffect, useState, type ReactNode } from 'react'
import { IconButton } from '../ui/IconButton'
import { Button } from '../ui/Button'
import { inputBase } from '../../lib/styles'
import {
  CloudUploadIcon,
  DeleteIcon,
  DownloadIcon,
  ForwardIcon,
  SuccessFilledIcon,
} from '../ui/icons'
import { formatAddr, formatDate, formatSize } from '../../lib/messageFormatters'
import type { Message } from '../../api/messages'
import type { CloudConnection } from '../../api/cloud'
import type { RelayConnection } from '../../api/relay'
import CategoryBadge from '../ui/CategoryBadge'

// 2-col / 3-row grid:
//   row 1: subject  |  actions
//   row 2: meta     |  date + size + category
//   row 3: "Show Headers" link
const headerGrid =
  'grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 items-start pb-4 border-b border-border-base'

const subjectStyle =
  'col-start-1 row-start-1 m-0 text-[22px] font-semibold leading-[1.21]'

const actionsSlot =
  'col-start-2 row-start-1 justify-self-end flex items-center justify-end gap-1'

const metaSlot = 'col-start-1 row-start-2 text-[13px] leading-[1.7] text-fg-muted'

const timeSlot = [
  'col-start-2 row-start-2 self-start',
  'flex flex-col items-end gap-1.5',
  'whitespace-nowrap text-right text-[13px] text-fg-muted',
].join(' ')

const showHeadersLink =
  'col-start-1 row-start-3 justify-self-start cursor-pointer pt-0.5 text-[13px] text-accent hover:underline'

const inlineBar = 'flex items-center gap-2.5 text-[13px] text-fg'

const inlineBarInput = `${inputBase} min-w-[220px] px-3 py-[7px] text-[13px]`

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mr-1.5 text-fg-muted">{label}:</span>
      <span className="text-fg">{children}</span>
    </div>
  )
}

type Mode = 'default' | 'delete' | 'forward'

function disabledReason(
  connection: CloudConnection | RelayConnection | null,
  kind: 'cloud' | 'relay',
): string | null {
  if (!connection) return 'Loading…'
  if (!connection.connected) {
    return kind === 'cloud'
      ? 'Connect to a Mailtrap sandbox first (cloud icon in the sidebar)'
      : 'Configure an SMTP relay first (relay icon in the sidebar)'
  }
  if (kind === 'cloud' && (connection as CloudConnection).mirror_enabled) {
    return 'Cloud mirror is on — every email is already sent automatically'
  }
  if (kind === 'relay' && (connection as RelayConnection).auto_relay_enabled) {
    return 'Auto-relay is on — every email is already forwarded automatically'
  }
  return null
}

interface Props {
  msg: Message
  cloudState: CloudConnection | null
  relayState: RelayConnection | null
  busy: boolean
  cloudSent: boolean
  onConfirmDelete: () => void
  onSendForward: (to: string[]) => Promise<void>
  onCloudForward: () => void
  onDownload: () => void
  onShowHeaders: () => void
  onEscapeIdle: () => void
}

// Single-address shape check. Deliberately permissive (we let the relay
// reject anything truly malformed); we just need to flag obvious typos
// before hitting the SMTP roundtrip.
const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseRecipients(raw: string): {
  valid: string[]
  invalid: string[]
} {
  const tokens = raw
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  const valid: string[] = []
  const invalid: string[] = []
  for (const t of tokens) {
    if (emailLike.test(t)) valid.push(t)
    else invalid.push(t)
  }
  return { valid, invalid }
}

export default function MessageHeader({
  msg,
  cloudState,
  relayState,
  busy,
  cloudSent,
  onConfirmDelete,
  onSendForward,
  onCloudForward,
  onDownload,
  onShowHeaders,
  onEscapeIdle,
}: Props) {
  const [mode, setMode] = useState<Mode>('default')
  const [forwardEmail, setForwardEmail] = useState('')
  const { valid: forwardValid, invalid: forwardInvalid } =
    parseRecipients(forwardEmail)

  // ESC closes inline modes; from idle, the parent decides what to do
  // (usually navigate back to the empty-state sandbox).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (mode !== 'default') {
        setMode('default')
        setForwardEmail('')
        return
      }
      onEscapeIdle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, onEscapeIdle])

  const relayReason = disabledReason(relayState, 'relay')
  const cloudReason = disabledReason(cloudState, 'cloud')

  const handleForwardSubmit = async () => {
    if (forwardValid.length === 0 || forwardInvalid.length > 0) return
    try {
      await onSendForward(forwardValid)
      setMode('default')
      setForwardEmail('')
    } catch {
      // Parent surfaces the error in a strip; keep the form open.
    }
  }

  return (
    <header className={headerGrid}>
      <h2 className={subjectStyle}>{msg.subject || '(no subject)'}</h2>
      <div className={actionsSlot}>
        {mode === 'default' && (
          <>
            <IconButton
              title={relayReason ?? `Forward via SMTP relay (${relayState?.host})`}
              disabled={!!relayReason}
              onClick={() => setMode('forward')}
            >
              <ForwardIcon size={18} />
            </IconButton>
            <IconButton
              title={
                cloudReason ??
                (cloudSent
                  ? `Sent to Mailtrap sandbox ${cloudState?.sandbox_id}`
                  : `Send to Mailtrap sandbox ${cloudState?.sandbox_id}`)
              }
              onClick={onCloudForward}
              disabled={!!cloudReason || busy || cloudSent}
              className={cloudSent ? 'text-success' : undefined}
            >
              {cloudSent ? (
                <SuccessFilledIcon size={18} />
              ) : (
                <CloudUploadIcon size={18} />
              )}
            </IconButton>
            <IconButton title="Download .eml" onClick={onDownload}>
              <DownloadIcon size={18} />
            </IconButton>
            <IconButton
              title="Delete email"
              onClick={() => setMode('delete')}
            >
              <DeleteIcon size={18} />
            </IconButton>
          </>
        )}
        {mode === 'delete' && (
          <div className={inlineBar}>
            <span>Delete this email?</span>
            <Button
              variant="danger-text"
              onClick={onConfirmDelete}
              disabled={busy}
            >
              Confirm
            </Button>
            <Button
              variant="outline"
              onClick={() => setMode('default')}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        )}
        {mode === 'forward' && (
          <form
            className={inlineBar}
            onSubmit={(e) => {
              e.preventDefault()
              handleForwardSubmit()
            }}
          >
            <input
              type="text"
              autoFocus
              placeholder="alice@example.com, bob@example.com"
              title={
                forwardInvalid.length > 0
                  ? `Invalid: ${forwardInvalid.join(', ')}`
                  : undefined
              }
              aria-invalid={forwardInvalid.length > 0 || undefined}
              className={inlineBarInput}
              value={forwardEmail}
              onChange={(e) => setForwardEmail(e.target.value)}
              disabled={busy}
            />
            <Button
              variant="primary"
              type="submit"
              disabled={
                busy || forwardValid.length === 0 || forwardInvalid.length > 0
              }
            >
              Send
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setMode('default')
                setForwardEmail('')
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </form>
        )}
      </div>
      <div className={metaSlot}>
        <MetaRow label="From">{formatAddr(msg.from)}</MetaRow>
        <MetaRow label="To">
          {msg.to.map((a) => formatAddr(a)).join(', ')}
        </MetaRow>
        {msg.cc.length > 0 && (
          <MetaRow label="Cc">
            {msg.cc.map((a) => formatAddr(a)).join(', ')}
          </MetaRow>
        )}
      </div>
      <div className={timeSlot}>
        <div>
          {formatDate(msg.date)}, {formatSize(msg.size)}
        </div>
        {msg.tags[0] && <CategoryBadge label={msg.tags[0]} />}
      </div>
      <button
        className={showHeadersLink}
        type="button"
        onClick={onShowHeaders}
      >
        Show Headers
      </button>
    </header>
  )
}
