import { type ReactNode } from 'react'

/**
 * Centered muted text inside a bordered card. Used for empty / loading /
 * placeholder states inside content panels (HtmlCheck tab, etc.).
 */
export function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-base bg-surface-raised p-6 text-center text-[13px] text-fg-icon">
      {children}
    </div>
  )
}
