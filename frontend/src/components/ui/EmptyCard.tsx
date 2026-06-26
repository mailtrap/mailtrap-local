import { type ReactNode } from 'react'
import { Panel } from './Panel'

/**
 * Centered muted text inside a Panel. Used for empty / loading /
 * placeholder states inside content panels (HtmlCheck tab, etc.).
 */
export function EmptyCard({ children }: { children: ReactNode }) {
  return (
    <Panel className="p-6 text-center text-[13px] text-fg-icon">
      {children}
    </Panel>
  )
}
