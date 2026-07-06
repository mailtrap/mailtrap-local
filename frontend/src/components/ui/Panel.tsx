import { type ReactNode } from 'react'

/**
 * Bordered card with the raised surface colour — used for grouped content
 * blocks (TechInfo sections, HtmlCheck issue cards, EmptyCard). Padding +
 * margin live at the callsite via `className` so the same chrome can host
 * different layouts.
 */
const base = 'rounded-lg border border-border-base bg-surface-raised'

export function Panel({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className ? `${base} ${className}` : base}>{children}</div>
  )
}
