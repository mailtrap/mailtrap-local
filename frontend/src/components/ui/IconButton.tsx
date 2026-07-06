import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type IconButtonVariant = 'toolbar' | 'header' | 'device'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant
  /** Active state is only meaningful for `device` variant. */
  active?: boolean
  children: ReactNode
}

/**
 * Unified icon-button primitive. Replaces the ~5 near-duplicate styled
 * blocks (toolbarBtn, iconBtn, deviceBtn, popoutBtn, closeBtn) that had
 * drifted across the codebase.
 *
 * Variants:
 *   - `toolbar` — 28×28, sidebar header buttons
 *   - `header`  — 32×32, per-message header actions (forward, delete, etc.)
 *   - `device`  — 32×32, device toggle with accent tint when active
 *
 * All variants share hover, :focus-visible ring, and disabled styling —
 * so keyboard users always see focus, and new icon buttons inherit
 * accessibility for free.
 */

// `data-active="true"` styling on the device variant only — exposed via
// arbitrary variant since we don't have a Tailwind plugin to register
// data-active as a first-class one.
const base = [
  'relative inline-flex cursor-pointer items-center justify-center rounded-md text-fg outline-none',
  'hover:bg-accent-soft hover:text-fg-icon',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-ring',
  'disabled:cursor-default disabled:opacity-50',
  'disabled:hover:bg-transparent disabled:hover:text-fg',
].join(' ')

const sizes: Record<IconButtonVariant, string> = {
  toolbar: 'w-7 h-7',
  header: 'w-8 h-8',
  device:
    'w-8 h-8 data-[active=true]:bg-accent-medium data-[active=true]:text-accent',
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton(
    { variant = 'header', active, className, type = 'button', ...rest },
    ref,
  ) {
    const combined = [base, sizes[variant], className].filter(Boolean).join(' ')
    return (
      <button
        ref={ref}
        type={type}
        className={combined}
        data-active={variant === 'device' ? String(!!active) : undefined}
        {...rest}
      />
    )
  },
)
