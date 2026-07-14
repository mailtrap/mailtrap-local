import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { partUrl, type AttachmentSummary } from '../../api/messages'
import { formatSize } from '../../lib/messageFormatters'

interface Props {
  messageId: string
  attachments: AttachmentSummary[]
}

const LIST_ID = 'message-attachments-list'

const toggleLink =
  'cursor-pointer whitespace-nowrap text-[13px] text-accent hover:underline'

const menuCss = [
  'absolute right-0 top-full z-40 m-0 min-w-[249px] max-w-[560px] list-none overflow-hidden p-0',
  'whitespace-normal text-left [word-break:break-word]',
  'rounded-lg border border-border-base bg-surface-raised',
  'shadow-[0_12px_32px_rgba(0,0,0,0.45)]',
].join(' ')

const downloadLinkCss = [
  'grid min-h-[45px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2.5',
  'text-[13px] text-fg no-underline transition-colors hover:bg-surface-hover',
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-ring',
].join(' ')

export function Attachments({ messageId, attachments }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open || e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    close()
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!open) return
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
  }

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
    <div ref={rootRef} className="relative" onBlur={onBlur} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={toggleLink}
        aria-expanded={open}
        aria-controls={LIST_ID}
        onClick={() => setOpen((o) => !o)}
      >
        Attachments ({attachments.length})
      </button>
      {open && (
        <ul id={LIST_ID} className={menuCss}>
          {attachments.map((a) => (
            <li key={a.part_id}>
              <a
                href={partUrl(messageId, a.part_id)}
                download={a.file_name || undefined}
                className={downloadLinkCss}
              >
                <span className="min-w-0 break-words">
                  {a.file_name || '(unnamed)'}
                </span>
                <span className="whitespace-nowrap text-fg-muted">
                  {formatSize(a.size)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
