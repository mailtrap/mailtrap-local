import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { css } from '@linaria/core'
import {
  accent,
  accentBgMedium,
  accentBgSoft,
  accentRing,
  iconIdle,
  text,
} from '../styles/tokens'

export type IconButtonVariant = 'toolbar' | 'header' | 'device'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant
  /** Active state is only meaningful for `device` variant. */
  active?: boolean
  children: ReactNode
}

/**
 * Unified icon-button primitive. Replaces the ~5 near-duplicate Linaria
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
const base = css`
  all: unset;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: ${text};
  cursor: pointer;

  &:hover {
    color: ${iconIdle};
    background: ${accentBgSoft};
  }
  &:focus-visible {
    outline: 2px solid ${accentRing};
    outline-offset: 1px;
  }
  &[disabled] {
    opacity: 0.5;
    cursor: default;
  }
  &[disabled]:hover {
    background: transparent;
    color: ${text};
  }
`

const sizes: Record<IconButtonVariant, string> = {
  toolbar: css`
    width: 28px;
    height: 28px;
  `,
  header: css`
    width: 32px;
    height: 32px;
  `,
  device: css`
    width: 32px;
    height: 32px;
    &[data-active='true'] {
      color: ${accent};
      background: ${accentBgMedium};
    }
  `,
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
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
