import { forwardRef, type InputHTMLAttributes } from 'react'

/**
 * Compact switch toggle. A hidden `<input type="checkbox">` carries
 * focus/keyboard semantics; a sibling `<span>` renders the visual
 * track + thumb via ::after. Click anywhere on the `<label>` wrapper
 * toggles state.
 *
 * 32×18 track with a 14 thumb — fits inline with 13px dialog labels.
 */
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
      className={[
        'group inline-flex cursor-pointer items-center gap-[10px] select-none',
        'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-disabled={disabled ? 'true' : undefined}
      htmlFor={id}
    >
      <input
        ref={ref}
        type="checkbox"
        className="peer absolute m-[-1px] h-px w-px overflow-hidden border-0 p-0 whitespace-nowrap [clip:rect(0_0_0_0)]"
        id={id}
        disabled={disabled}
        {...rest}
      />
      <span
        aria-hidden="true"
        className={[
          // Track
          'relative inline-block h-[18px] w-8 shrink-0 rounded-full border bg-surface-base',
          'border-border-base transition-[background-color,border-color] duration-150',
          // Track on label hover (group)
          'group-hover:border-fg-muted',
          // Track when checked
          'peer-checked:border-accent peer-checked:bg-accent',
          'group-hover:peer-checked:border-accent-hover group-hover:peer-checked:bg-accent-hover',
          // Focus ring (bubbles up from the hidden input)
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-ring',
          // Thumb (::after) — idle position + colour
          "after:absolute after:top-[1px] after:left-[2px] after:h-3.5 after:w-3.5 after:rounded-full after:bg-fg-icon after:transition-[left,background-color] after:duration-[180ms] after:content-['']",
          // Thumb when checked
          'peer-checked:after:left-[14px] peer-checked:after:bg-fg',
        ].join(' ')}
      />
      {label && <span>{label}</span>}
    </label>
  )
})
