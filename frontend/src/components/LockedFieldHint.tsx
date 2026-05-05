import { lockedHint } from './dialogStyles'

/**
 * Inline hint shown beneath a locked input. Reads "from <config-path>" so
 * the user knows where to go if they want to change the value. Falls back
 * to the bare phrase "from config" when no path is available (shouldn't
 * happen in practice — locked fields require a loaded config file).
 */
export function LockedFieldHint({ path }: { path: string | null }) {
  return (
    <span className={lockedHint}>
      from {path ? <code>{path}</code> : <code>config</code>}
    </span>
  )
}
