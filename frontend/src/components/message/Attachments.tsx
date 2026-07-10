import { useEffect, useRef, useState } from 'react'
import { partUrl, type AttachmentSummary } from '../../api/messages'
import { formatSize } from '../../lib/messageFormatters'

interface Props {
  messageId: string
  attachments: AttachmentSummary[]
}

const LIST_ID = 'message-attachments-list'

const toggleLink =
  'cursor-pointer whitespace-nowrap text-[13px] text-accent hover:underline'

// Port of the falcon sandbox attachments dropdown: a CSS table anchored
// under the toggle link, each row a full-width <a download>. Panel and
// text styling follow SettingsMenu so all overlays read the same. The
// whitespace/text-align resets undo what the header's right column sets.
const menuCss = [
  'absolute right-0 top-full z-40 table overflow-hidden',
  'min-w-[249px] max-w-[560px]',
  'whitespace-normal text-left [word-break:break-word]',
  'rounded-lg border border-border-base bg-surface-raised',
  'shadow-[0_12px_32px_rgba(0,0,0,0.45)]',
].join(' ')

const rowCss = [
  'table-row h-[45px] cursor-pointer text-[13px] text-fg',
  'transition-colors hover:bg-surface-hover',
].join(' ')

const cellCss = 'table-cell p-2.5 align-middle'

export function Attachments({ messageId, attachments }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  if (attachments.length === 0) return null

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={toggleLink}
        aria-expanded={open}
        aria-controls={LIST_ID}
        onClick={() => setOpen((o) => !o)}
      >
        Attachments ({attachments.length})
      </button>
      {open && (
        <div id={LIST_ID} role="list" className={menuCss}>
          {attachments.map((a) => (
            <a
              key={a.part_id}
              role="listitem"
              href={partUrl(messageId, a.part_id)}
              download={a.file_name || undefined}
              className={rowCss}
            >
              <span className={cellCss}>{a.file_name || '(unnamed)'}</span>
              <span className={`${cellCss} whitespace-nowrap text-fg-muted`}>
                {formatSize(a.size)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
