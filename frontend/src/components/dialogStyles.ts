/**
 * Shared Tailwind class strings for Radix Dialog-based settings dialogs
 * (CloudConnectDialog + RelayConnectDialog + WebhookConnectDialog).
 * Keeps all three dialogs visually locked to the same shell — palette,
 * spacing, and control styles flow from one place.
 *
 * Pattern: each export is a space-separated list of utility classes
 * applied via `className={overlay}` etc. Descendant selectors (e.g.
 * "style every nested `<h2>`") use arbitrary variants like
 * `[&_h2]:font-semibold` so we don't have to touch every child element
 * inside the dialogs.
 */

export const overlay = 'fixed inset-0 z-50 bg-black/60'

export const content = [
  'fixed top-1/2 left-1/2 z-[51] -translate-x-1/2 -translate-y-1/2',
  'w-[460px] max-w-[calc(100vw-32px)]',
  'rounded-[10px] border border-border-base bg-surface-raised text-fg',
  'px-6 pt-[22px] pb-5',
  'shadow-[0_20px_60px_rgba(0,0,0,0.5)]',
  // Headers + lead paragraphs — these styles target nested elements so
  // consumers don't have to repeat them on every <h2> / <p className="lead">.
  '[&_h2]:m-0 [&_h2]:mb-1.5 [&_h2]:text-[17px] [&_h2]:font-semibold',
  '[&_p.lead]:m-0 [&_p.lead]:mb-4 [&_p.lead]:text-[13px] [&_p.lead]:leading-[1.5] [&_p.lead]:text-fg-muted',
].join(' ')

// Form-field row: stacked label + input + hint, with shared control
// styles for nested `<input>` / `<select>`.
export const field = [
  'mb-3.5 flex flex-col gap-1.5',
  '[&_label]:text-[13px] [&_label]:font-medium [&_label]:text-fg',
  '[&_.hint]:text-xs [&_.hint]:leading-[1.5] [&_.hint]:text-fg-muted',
  '[&_.hint_a]:text-accent [&_.hint_a]:no-underline',
  '[&_.hint_a:hover]:underline',
  // Inputs + selects: reset native chrome, paint our own.
  '[&_input]:rounded-[7px] [&_input]:border [&_input]:border-border-base [&_input]:bg-surface-base [&_input]:px-3 [&_input]:py-2 [&_input]:text-[13px] [&_input]:text-fg [&_input]:outline-none',
  '[&_input::placeholder]:text-fg-muted',
  '[&_input:focus]:border-accent',
  // Selects: same shell as inputs + the dialog-select-chevron rule
  // from index.css for the inline drop-down arrow.
  '[&_select]:rounded-[7px] [&_select]:border [&_select]:border-border-base [&_select]:bg-surface-base [&_select]:px-3 [&_select]:py-2 [&_select]:pr-8 [&_select]:text-[13px] [&_select]:text-fg [&_select]:outline-none [&_select]:appearance-none [&_select]:cursor-pointer',
  '[&_select]:dialog-select-chevron',
  '[&_select:focus]:border-accent',
].join(' ')

export const fieldRow = 'grid grid-cols-[2fr_1fr] gap-2.5'

export const toggleRow = 'flex items-center gap-2.5 pt-2.5 pb-1 text-[13px]'

export const toggleDesc = 'ml-[26px] text-xs leading-[1.5] text-fg-muted'

// Applied to inputs/selects whose value is pinned by the YAML config —
// visually mutes the control to signal "you can't edit this here".
export const lockedInput = 'cursor-not-allowed opacity-70 !bg-surface-base'

export const lockedHint = [
  'mt-1 inline-flex items-center gap-1 text-[11px] italic text-fg-muted',
  '[&_code]:font-mono [&_code]:not-italic [&_code]:text-[11px] [&_code]:text-fg',
].join(' ')

export const configBanner = [
  'mb-3.5 rounded-md border border-border-base bg-surface-base',
  'px-3 py-[9px] text-xs leading-[1.5] text-fg-muted',
  '[&_code]:font-mono [&_code]:text-[11px] [&_code]:text-fg',
].join(' ')

export const errorBox = [
  'mb-3 rounded-md border px-3 py-2 text-xs leading-[1.5]',
  'bg-danger-soft border-danger-border text-danger',
].join(' ')

export const actions = 'mt-[18px] flex justify-end gap-2'

// Variant-driven button. Use as `className={btn}` and set
// `data-variant="primary" | "outline" | "danger-text"` on the element
// to pick the colourway.
export const btn = [
  'inline-flex cursor-pointer items-center justify-center rounded-[7px] border border-transparent',
  'px-4 py-[7px] text-[13px] font-semibold outline-none',
  // primary
  'data-[variant=primary]:bg-accent data-[variant=primary]:text-fg',
  'data-[variant=primary]:hover:bg-accent-hover',
  // danger-text
  'data-[variant=danger-text]:border-danger data-[variant=danger-text]:text-danger',
  'data-[variant=danger-text]:hover:bg-danger-soft',
  // outline
  'data-[variant=outline]:border-accent data-[variant=outline]:text-accent',
  'data-[variant=outline]:hover:bg-accent-soft',
  // disabled
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')
