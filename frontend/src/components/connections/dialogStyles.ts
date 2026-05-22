/**
 * Shared Tailwind class strings for Radix Dialog-based settings dialogs
 * (CloudConnectDialog + RelayConnectDialog + WebhookConnectDialog +
 * AboutDialog). Keeps all dialogs visually locked to the same shell —
 * palette, spacing, and control styles flow from one place.
 *
 * Convention: shells (`content`, `field`, `lockedHint`, `configBanner`)
 * carry only the wrapper's own utilities. Per-element classes
 * (`dialogTitle`, `dialogLead`, `fieldLabel`, `fieldInput`, etc.) are
 * applied directly to the elements they style at the dialog callsites.
 * This avoids parent-side `[&_…]:` selectors that route styles through
 * anonymous descendant class hooks.
 */

import { inputBase } from '../../lib/styles'

export const overlay = 'fixed inset-0 z-50 bg-black/60'

// Dialog shell — positioning + chrome only. Title/lead get their own
// classes at the callsite.
export const content = [
  'fixed top-1/2 left-1/2 z-[51] -translate-x-1/2 -translate-y-1/2',
  'w-[460px] max-w-[calc(100vw-32px)]',
  'rounded-[10px] border border-border-base bg-surface-raised text-fg',
  'px-6 pt-[22px] pb-5',
  'shadow-[0_20px_60px_rgba(0,0,0,0.5)]',
].join(' ')

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

export const toggleDesc = 'ml-[26px] text-xs leading-[1.5] text-fg-muted'

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
