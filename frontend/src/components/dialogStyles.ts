import { css } from '@linaria/core'
import {
  accent,
  accentBgSoft,
  accentHover,
  border,
  bg,
  danger,
  dangerBgSoft,
  dangerBorderSoft,
  raised,
  text,
  textMuted,
} from '../styles/tokens'

/**
 * Shared Linaria styles for Radix Dialog-based settings dialogs (currently
 * CloudConnectDialog + RelayConnectDialog). Keeps both dialogs visually
 * locked to the same shell — palette / spacing / control styles all flow
 * from one place.
 */

export const overlay = css`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 50;
`

export const content = css`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 460px;
  max-width: calc(100vw - 32px);
  background: ${raised};
  border: 1px solid ${border};
  border-radius: 10px;
  padding: 22px 24px 20px;
  color: ${text};
  z-index: 51;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);

  h2 {
    margin: 0 0 6px;
    font-size: 17px;
    font-weight: 600;
  }
  p.lead {
    margin: 0 0 16px;
    color: ${textMuted};
    font-size: 13px;
    line-height: 1.5;
  }
`

export const field = css`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;

  label {
    font-size: 13px;
    font-weight: 500;
    color: ${text};
  }
  .hint {
    font-size: 12px;
    color: ${textMuted};
    line-height: 1.5;
  }
  .hint a {
    color: ${accent};
    text-decoration: none;
  }
  .hint a:hover {
    text-decoration: underline;
  }
  input,
  select {
    all: unset;
    background: ${bg};
    border: 1px solid ${border};
    border-radius: 7px;
    padding: 8px 12px;
    color: ${text};
    font-size: 13px;
    &::placeholder {
      color: ${textMuted};
    }
    &:focus {
      border-color: ${accent};
    }
  }
  select {
    cursor: pointer;
    /* The "all: unset" above strips the native chevron — paint our own
       as a background SVG so selects look consistent with the sidebar
       category trigger. Inline data URI uses textMuted (#8b9aae); the
       icon mirrors components/icons.tsx ChevronDownIcon at 14px. */
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16' fill='%238b9aae'><path fill-rule='evenodd' d='M3.22 5.97a.75.75 0 0 1 1.06 0L8 9.69l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.03a.75.75 0 0 1 0-1.06Z' clip-rule='evenodd'/></svg>");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 32px;
  }
  select:hover,
  select:focus {
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16' fill='%234c83ee'><path fill-rule='evenodd' d='M3.22 5.97a.75.75 0 0 1 1.06 0L8 9.69l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.03a.75.75 0 0 1 0-1.06Z' clip-rule='evenodd'/></svg>");
  }
`

export const fieldRow = css`
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 10px;
`

export const toggleRow = css`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0 4px;
  font-size: 13px;
`

export const toggleDesc = css`
  color: ${textMuted};
  font-size: 12px;
  margin-left: 26px;
  line-height: 1.5;
`

/**
 * Applied to inputs/selects whose value is pinned by the YAML config file.
 * Visually mutes the control to signal "you can't edit this here."
 */
export const lockedInput = css`
  opacity: 0.7;
  cursor: not-allowed;
  background: ${bg} !important;
`

export const lockedHint = css`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: ${textMuted};
  margin-top: 4px;
  font-style: italic;

  code {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-style: normal;
    color: ${text};
    font-size: 11px;
  }
`

export const configBanner = css`
  background: ${bg};
  border: 1px solid ${border};
  border-radius: 6px;
  padding: 9px 12px;
  font-size: 12px;
  color: ${textMuted};
  line-height: 1.5;
  margin-bottom: 14px;

  code {
    font-family: ui-monospace, SFMono-Regular, monospace;
    color: ${text};
    font-size: 11px;
  }
`

export const errorBox = css`
  background: ${dangerBgSoft};
  border: 1px solid ${dangerBorderSoft};
  color: ${danger};
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  margin-bottom: 12px;
  line-height: 1.5;
`

export const actions = css`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
`

export const btn = css`
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 16px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;

  &[data-variant='primary'] {
    background: ${accent};
    color: ${text};
    &:hover {
      background: ${accentHover};
    }
  }
  &[data-variant='danger-text'] {
    color: ${danger};
    border-color: ${danger};
    &:hover {
      background: ${dangerBgSoft};
    }
  }
  &[data-variant='outline'] {
    color: ${accent};
    border-color: ${accent};
    &:hover {
      background: ${accentBgSoft};
    }
  }
  &[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
`
