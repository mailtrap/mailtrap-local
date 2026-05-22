import { fieldInput, fieldSelect, lockedInput } from './dialogStyles'

/**
 * Derives the lock-state helpers each connection dialog needs:
 *
 *   - `isLocked(key)` — true if that field is pinned by the YAML overlay.
 *   - `allLocked` — every key is locked (banner says "All settings are
 *     pinned by ..." and the Save button is hidden).
 *   - `anyLocked` — at least one key is locked (config banner shows).
 *   - `inputClass(key)` — composes `fieldInput` with `lockedInput` when
 *     the field is locked, so the muted "you can't edit this" look flows
 *     from one helper instead of inline ternaries at every input.
 *
 * Pass `state?.locked` plus a defaults object whose keys are the
 * complete set of config keys for that dialog. The defaults are used
 * before the provider's initial state has landed.
 */
export function lockedFields<K extends string>(
  locked: Record<K, boolean> | undefined,
  defaults: Record<K, boolean>,
) {
  const map = locked ?? defaults
  const keys = Object.keys(map) as K[]
  const isLocked = (k: K) => Boolean(map[k])
  return {
    isLocked,
    allLocked: keys.every((k) => map[k]),
    anyLocked: keys.some((k) => map[k]),
    inputClass: (k: K) =>
      isLocked(k) ? `${fieldInput} ${lockedInput}` : fieldInput,
    selectClass: (k: K) =>
      isLocked(k) ? `${fieldSelect} ${lockedInput}` : fieldSelect,
  }
}
