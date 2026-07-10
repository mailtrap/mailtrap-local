/**
 * Shared Tailwind class strings for Radix Dialog-based settings dialogs
 * (CloudConnectDialog + RelayConnectDialog + WebhookConnectDialog +
 * AboutDialog). Keeps all dialogs visually locked to the same shell —
 * palette, spacing, and control styles flow from one place.
 *
 * Convention: shells (`content`, `contentHeader`, `contentBody`,
 * `field`, `lockedHint`, `configBanner`) carry only the wrapper's own
 * utilities. Per-element classes
 * (`dialogTitle`, `dialogLead`, `fieldLabel`, `fieldInput`, etc.) are
 * applied directly to the elements they style at the dialog callsites.
 * This avoids parent-side `[&_…]:` selectors that route styles through
 * anonymous descendant class hooks.
 */

import { inputBase } from '../../lib/styles'

export const overlay = 'fixed inset-0 z-50 bg-black/60'

// Dialog shell — positioning + chrome only. Height is capped so tall
// dialogs (e.g. relay with Advanced expanded on a short viewport) never
// clip past the screen edges: the title (`contentHeader`) stays pinned,
// the form (`contentBody`) scrolls, and the sticky `actions` row keeps
// the buttons visible. Padding lives on header/body, not the panel, so
// the scroll area runs edge to edge.
export const content = [
  'fixed top-1/2 left-1/2 z-[51] -translate-x-1/2 -translate-y-1/2',
  'flex max-h-[85vh] w-[460px] max-w-[calc(100vw-32px)] flex-col',
  'overflow-hidden rounded-[10px] border border-border-base bg-surface-raised text-fg',
  'shadow-[0_20px_60px_rgba(0,0,0,0.5)]',
].join(' ')

export const contentHeader = 'shrink-0 px-6 pt-[22px]'

// No bottom padding here — the sticky `actions` row carries it (pb-5).
// Padding on the scroll container itself would sit BELOW the stuck row
// (sticky offsets account for margins, so the row can't be pulled into
// the padding zone with a negative margin) and scrolled content would
// show through the strip.
export const contentBody = 'min-h-0 overflow-y-auto px-6'

export const dialogTitle = 'm-0 mb-1.5 text-[17px] font-semibold'

export const dialogLead = 'm-0 mb-4 text-[13px] leading-[1.5] text-fg-muted'

// Form-field shell — stack a label + input + optional hint. Each child
// gets its own class below (fieldLabel / fieldInput / fieldSelect /
// fieldHint).
export const field = 'mb-3.5 flex flex-col gap-1.5'

export const fieldLabel = 'text-[13px] font-medium text-fg'

export const fieldHint = 'text-xs leading-[1.5] text-fg-muted'

export const fieldHintLink = 'text-accent no-underline hover:underline'

export const fieldInput = `${inputBase} px-3 py-2 text-[13px]`

// Select reuses the input shell + dialog-select-chevron (from
// index.css) for the inline drop-down arrow.
export const fieldSelect = [
  inputBase,
  'px-3 py-2 pr-8 text-[13px]',
  'appearance-none cursor-pointer dialog-select-chevron',
].join(' ')

export const fieldRow = 'grid grid-cols-[2fr_1fr] gap-2.5'

export const toggleRow = 'flex items-center gap-2.5 pt-2.5 pb-1 text-[13px]'

// The Toggle's 32px track + 10px inner gap == 42px to the label text;
// description should sit under the label, not under the track.
export const toggleDesc = 'ml-[42px] text-xs leading-[1.5] text-fg-muted'

// Applied to inputs/selects whose value is pinned by the YAML config —
// visually mutes the control to signal "you can't edit this here".
export const lockedInput = 'cursor-not-allowed opacity-70 !bg-surface-base'

export const lockedHint =
  'mt-1 inline-flex items-center gap-1 text-[11px] italic text-fg-muted'

export const lockedHintCode = 'font-mono not-italic text-[11px] text-fg'

export const configBanner = [
  'mb-3.5 rounded-md border border-border-base bg-surface-base',
  'px-3 py-[9px] text-xs leading-[1.5] text-fg-muted',
].join(' ')

export const configBannerCode = 'font-mono text-[11px] text-fg'

export const errorBox = [
  'mb-3 rounded-md border px-3 py-2 text-xs leading-[1.5]',
  'bg-danger-soft border-danger-border text-danger',
].join(' ')

// Bottom button row. Sticky so the buttons stay reachable while
// contentBody scrolls. The row owns the dialog's bottom padding (pb-5,
// opaque background) so it sticks truly flush with the scrollport
// bottom and nothing shows through beneath it; mt-2.5 + pt-2 preserve
// the usual gap above — the margin collapses with the previous
// sibling's, the padding stays opaque.
export const actions = [
  'sticky bottom-0 mt-2.5 flex justify-end gap-2',
  'bg-surface-raised pt-2 pb-5',
].join(' ')

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
