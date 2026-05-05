/**
 * Design tokens — single source of truth for the dark palette used
 * across the sandbox UI.
 *
 * Use via Linaria interpolation: `css\`background: ${bg}\`` — values are
 * static-compiled at build time.
 */

// Surfaces
export const bg = '#131e2b' // grey.void (page background)
export const raised = '#172230' // grey.bold (sidebar rows, cards, modals)
export const hover = '#212d3c' // grey.shade (hover surface, also border color)
export const border = '#212d3c' // border.light
export const borderSubtle = '#2a394b'

// Text
export const text = '#fbfcfc' // navy.air (primary)
export const textMuted = '#687a91' // grey.muted (secondary, labels)
export const iconIdle = '#8b9aae' // tertiary / inactive icon color

// Accent
export const accent = '#4c83ee' // blue.neutral
export const accentHover = '#3b6fd9'
export const accentBgSoft = 'rgba(76, 131, 238, 0.08)' // hover bg for icon buttons
export const accentBgMedium = 'rgba(76, 131, 238, 0.12)'
export const accentRing = 'rgba(76, 131, 238, 0.5)' // :focus-visible outline

// Status
export const success = '#22bc66'
export const danger = '#ff5757'
export const dangerBgSoft = 'rgba(255, 87, 87, 0.08)'
export const dangerBorderSoft = 'rgba(255, 87, 87, 0.3)'
