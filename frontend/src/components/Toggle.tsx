import { forwardRef, type InputHTMLAttributes } from 'react'
import { css } from '@linaria/core'
import {
  accent,
  accentHover,
  accentRing,
  bg,
  border,
  iconIdle,
  text,
  textMuted,
} from '../styles/tokens'

/**
 * Compact switch toggle. A hidden `<input type="checkbox">` carries
 * focus/keyboard semantics; a sibling `<span>` renders the visual
 * track + thumb via ::before/::after pseudo-elements. Click anywhere on
 * the <label> wrapper toggles state.
 *
 * 32×18 track with a 14 thumb — fits inline with 13px dialog labels.
 */

const TRACK_WIDTH = 32
const TRACK_HEIGHT = 18
const THUMB_SIZE = 14
const THUMB_INSET = 2 // px gap between thumb and track edge

const root = css`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;

  &[data-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.5;
  }
`

const inputCss = css`
  /* Visually hidden but still focusable + keyboard-toggleable. */
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
`

const track = css`
  position: relative;
  display: inline-block;
  flex-shrink: 0;
  width: ${TRACK_WIDTH}px;
  height: ${TRACK_HEIGHT}px;
  border-radius: ${TRACK_HEIGHT / 2}px;
  background: ${bg};
  border: 1px solid ${border};
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  &::after {
    content: '';
    position: absolute;
    top: ${(TRACK_HEIGHT - THUMB_SIZE) / 2 - 1}px;
    left: ${THUMB_INSET}px;
    width: ${THUMB_SIZE}px;
    height: ${THUMB_SIZE}px;
    border-radius: 50%;
    background: ${iconIdle};
    transition:
      left 0.18s ease,
      background 0.15s ease;
  }

  /* Hover on the wrapper label tightens the border. */
  label:hover & {
    border-color: ${textMuted};
  }

  /* Checked state — accent color, thumb slides right. */
  input:checked ~ & {
    background: ${accent};
    border-color: ${accent};
  }
  input:checked ~ &::after {
    left: ${TRACK_WIDTH - THUMB_SIZE - THUMB_INSET - 2}px;
    background: ${text};
  }
  label:hover input:checked ~ & {
    background: ${accentHover};
    border-color: ${accentHover};
  }

  /* Focus ring on the input bubbles up to the visible track. */
  input:focus-visible ~ & {
    outline: 2px solid ${accentRing};
    outline-offset: 2px;
  }
`

interface ToggleProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  label?: string
  description?: string
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  { label, description: _description, disabled, className, id, ...rest },
  ref,
) {
  return (
    <label
      className={[root, className].filter(Boolean).join(' ')}
      data-disabled={disabled ? 'true' : undefined}
      htmlFor={id}
    >
      <input
        ref={ref}
        type="checkbox"
        className={inputCss}
        id={id}
        disabled={disabled}
        {...rest}
      />
      <span className={track} aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  )
})
