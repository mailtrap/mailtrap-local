import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

const triggerCss = [
  'inline-flex items-center border-0 bg-transparent p-0 cursor-help text-fg-muted',
  'transition-colors hover:text-fg focus:outline-none focus-visible:text-fg',
].join(' ')

const contentCss = [
  'pointer-events-none absolute left-0 top-full z-50 w-max max-w-[320px] pt-2',
  'invisible opacity-0 transition-opacity duration-150',
  'data-[open=true]:pointer-events-auto data-[open=true]:visible data-[open=true]:opacity-100',
].join(' ')

const bubbleCss = [
  'rounded-lg border border-border-subtle bg-surface-hover px-3 py-2.5',
  'text-left text-[13px] font-normal leading-[1.6] text-fg',
  'shadow-[0_12px_32px_rgba(0,0,0,0.45)]',
].join(' ')

export function InfoTooltip({
  content,
  label,
  children,
}: {
  content: ReactNode
  label: string
  children: ReactNode
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Escape' || !open) return

    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
  }

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (document.activeElement !== triggerRef.current) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={id}
        className={triggerCss}
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      >
        {children}
      </button>
      <div role="tooltip" id={id} className={contentCss} data-open={String(open)}>
        <div className={bubbleCss}>{content}</div>
      </div>
    </div>
  )
}
