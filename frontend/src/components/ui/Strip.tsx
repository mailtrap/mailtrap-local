import { type ReactNode } from 'react'
import { CloseIcon, SuccessFilledIcon } from './icons'

/**
 * Dismissable inline banner — used for transient action feedback (e.g.
 * "Forwarded to alice@example.com", "Delete failed: ..."). Variant drives
 * colour, shape drives where the banner lives:
 *
 *   - `shape="card"` (default) — rounded card, sits inside a content area
 *     with its own margin-top. Used in MessageView under the header.
 *   - `shape="banner"` — full-width strip with border-bottom, sits between
 *     sibling sections. Used in Sidebar between toolbar and list.
 *
 * Pass `onDismiss` to render an `×` button; pass `icon` to add a leading
 * icon (defaults to a check-circle for `variant="success"`).
 */

const base = 'flex items-center gap-2'

const variants: Record<'success' | 'error', string> = {
  success: 'text-success',
  error: 'text-danger',
}

const variantBg: Record<'success' | 'error', string> = {
  success: 'border-success/30 bg-success/[0.08]',
  error: 'border-danger-border bg-danger-soft',
}

const shapes = {
  card: 'mt-2.5 rounded-md border px-3 py-2 text-xs leading-[1.4]',
  banner: 'border-b px-3 py-2 text-xs leading-[1.4]',
}

const dismissBg: Record<'success' | 'error', string> = {
  success: 'hover:bg-success/20',
  error: 'hover:bg-danger-border',
}

const dismissBtn = [
  'inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded',
].join(' ')

export function Strip({
  variant,
  shape = 'card',
  icon,
  onDismiss,
  role,
  children,
}: {
  variant: 'success' | 'error'
  shape?: 'card' | 'banner'
  icon?: ReactNode
  onDismiss?: () => void
  role?: 'alert' | 'status'
  children: ReactNode
}) {
  const resolvedIcon =
    icon === undefined && variant === 'success' ? (
      <SuccessFilledIcon size={14} />
    ) : (
      icon
    )
  const className = [base, shapes[shape], variantBg[variant], variants[variant]]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={className} role={role}>
      {resolvedIcon}
      <span className="flex-1 min-w-0">{children}</span>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          className={`${dismissBtn} ${variants[variant]} ${dismissBg[variant]}`}
          onClick={onDismiss}
        >
          <CloseIcon size={10} />
        </button>
      )}
    </div>
  )
}
