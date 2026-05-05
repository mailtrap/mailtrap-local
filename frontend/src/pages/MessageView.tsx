import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { css } from '@linaria/core'
import * as Tabs from '@radix-ui/react-tabs'
import { Highlight, themes } from 'prism-react-renderer'
import {
  DeleteIcon,
  ForwardIcon,
  HelpIcon,
  SuccessFilledIcon,
  DownloadIcon,
  ExternalLinkIcon,
  MobileIcon,
  TabletIcon,
  DesktopIcon,
  CloudUploadIcon,
  CloseIcon,
} from '../components/icons'
import {
  getMessage,
  getRawMessage,
  getHeaders,
  getHtmlCheck,
  deleteMessage,
  rawMessageUrl,
  type Address,
  type ClientCategory,
  type HeadersMap,
  type HtmlCheckClient,
  type HtmlCheckReport,
  type Message,
} from '../api/messages'
import {
  filteredFamilySupportStats,
  filteredMarketShareInfo,
  clientPassesFilters,
  noSupportIssueCount,
} from '../lib/htmlCheckStats'
import { sendMessageToCloud } from '../api/cloud'
import { releaseMessage } from '../api/relay'
import { useCloudConnection } from '../hooks/useCloudConnection'
import { useRelayConnection } from '../hooks/useRelayConnection'
import { IconButton } from '../components/IconButton'
import {
  accent,
  accentBgSoft,
  danger,
  dangerBgSoft,
  dangerBorderSoft,
  success,
} from '../styles/tokens'
import { extractApiError } from '../api/client'

const wrap = css`
  margin: 0;
`

const header = css`
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: 6px;
  column-gap: 24px;
  align-items: start;
  padding-bottom: 16px;
  border-bottom: 1px solid #212d3c;

  h2 {
    grid-column: 1;
    grid-row: 1;
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    line-height: 1.21;
  }
  .actions {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    align-items: center;
  }
  .meta {
    grid-column: 1;
    grid-row: 2;
    color: #687a91;
    font-size: 13px;
    line-height: 1.7;
  }
  .meta .label {
    color: #687a91;
    margin-right: 6px;
  }
  .meta .val {
    color: #fbfcfc;
  }
  .timesize {
    grid-column: 2;
    grid-row: 2;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    color: #687a91;
    font-size: 13px;
    white-space: nowrap;
    text-align: right;
    align-self: start;
  }
  .timesize .category {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    background: rgba(76, 131, 238, 0.12);
    color: #4c83ee;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.6;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .headersLink {
    grid-column: 1;
    grid-row: 3;
    justify-self: start;
    all: unset;
    color: #4c83ee;
    font-size: 13px;
    cursor: pointer;
    padding-top: 2px;
    &:hover {
      text-decoration: underline;
    }
  }
`

/* Positioning override for the pop-out button overlaying each tab's content. */
const popoutPosition = css`
  position: absolute;
  top: 0;
  right: 0;
`

/* Inline error strip — replaces alert() for action failures (delete, cloud
   forward). Appears just below the header, dismissable with ×. */
const successStrip = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid rgba(34, 188, 102, 0.3);
  background: rgba(34, 188, 102, 0.08);
  color: ${success};
  font-size: 12px;
  border-radius: 6px;
  line-height: 1.4;

  span {
    flex: 1;
    min-width: 0;
  }
  button {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: ${success};
    cursor: pointer;
    &:hover {
      background: rgba(34, 188, 102, 0.2);
    }
  }
`

const errorStrip = css`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid ${dangerBorderSoft};
  background: ${dangerBgSoft};
  color: ${danger};
  font-size: 12px;
  border-radius: 6px;
  line-height: 1.4;

  span {
    flex: 1;
    min-width: 0;
  }

  button {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: ${danger};
    cursor: pointer;
    &:hover {
      background: ${dangerBorderSoft};
    }
  }
`

const inlineBar = css`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #fbfcfc;

  input {
    all: unset;
    background: #131e2b;
    border: 1px solid #212d3c;
    border-radius: 7px;
    padding: 7px 12px;
    color: #fbfcfc;
    font-size: 13px;
    min-width: 220px;
    &::placeholder {
      color: #687a91;
    }
    &:focus {
      border-color: #4c83ee;
    }
  }
`

const pillBtn = css`
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;

  &[data-variant='primary'] {
    background: #4c83ee;
    color: #fbfcfc;
    &:hover {
      background: #3b6fd9;
    }
  }
  &[data-variant='danger-text'] {
    color: #ff5757;
    border-color: #ff5757;
    &:hover {
      background: rgba(255, 87, 87, 0.08);
    }
  }
  &[data-variant='outline'] {
    color: #4c83ee;
    border-color: #4c83ee;
    &:hover {
      background: rgba(76, 131, 238, 0.08);
    }
  }
  &[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const deviceBar = css`
  position: relative;
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 8px 0 12px;
`

const previewWrap = css`
  position: relative;
`

const iframeFrame = css`
  display: flex;
  justify-content: center;

  /* Frame stays inline-block in every mode so switching devices animates
     in place instead of jumping between block/inline-block layouts. Chrome
     (border, padding, radius) is always present and just collapses to
     transparent/zero on desktop, so all properties transition smoothly. */
  .frame {
    display: inline-block;
    box-sizing: content-box;
    border: 2px solid transparent;
    background: transparent;
    border-radius: 0;
    padding: 0;
    transition:
      width 250ms ease,
      height 250ms ease,
      padding 250ms ease,
      border-radius 250ms ease,
      border-color 250ms ease,
      background-color 250ms ease;
  }

  &[data-device='mobile'] .frame,
  &[data-device='tablet'] .frame {
    border-color: #4c83ee;
    background: #131e2b;
  }
  &[data-device='mobile'] .frame {
    border-radius: 32px;
    padding: 14px 10px;
  }
  &[data-device='tablet'] .frame {
    border-radius: 18px;
    padding: 14px;
  }
`

const tabList = css`
  display: flex;
  gap: 18px;
  border-bottom: 1px solid #212d3c;
  margin-top: 16px;
  padding: 0;
`

const tabBadge = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  margin-left: 8px;
  border-radius: 9px;
  background: ${danger};
  color: #fbfcfc;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  vertical-align: middle;
`

const tabTrigger = css`
  all: unset;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  color: #8b9aae;
  padding: 10px 0;
  cursor: pointer;
  position: relative;
  line-height: 1;

  &:hover {
    color: #fbfcfc;
  }
  &[data-state='active'] {
    color: #fbfcfc;
  }
  &[data-state='active']::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: #4c83ee;
  }
`

const tabContent = css`
  padding-top: 16px;
`

const iframeCss = css`
  display: block;
  width: 100%;
  height: 100%;
  border: 1px solid #212d3c;
  border-radius: 7px;
  background: #fff;
`

const preCss = css`
  background: rgba(0, 0, 0, 0.2);
  color: #fbfcfc;
  padding: 12px;
  border-radius: 7px;
  border: 1px solid #212d3c;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  /* Match the desktop HTML iframe so short payloads still fill the viewport. */
  min-height: max(500px, calc(100vh - 260px));
  box-sizing: border-box;
`

const codeViewer = css`
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid #212d3c;
  border-radius: 7px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  margin: 0;
  padding: 0;
  min-height: max(500px, calc(100vh - 260px));
  box-sizing: border-box;

  .row {
    display: grid;
    grid-template-columns: 48px 1fr;
  }
  .ln {
    user-select: none;
    text-align: right;
    padding: 0 12px 0 10px;
    color: #4d5a6a;
    border-right: 1px solid #212d3c;
  }
  .code {
    padding: 0 14px;
    white-space: pre-wrap;
    word-break: break-word;
  }
`

const techSection = css`
  background: #172230;
  border: 1px solid #212d3c;
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 16px;
`

const techTable = css`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid #212d3c;
  border-radius: 8px;
  overflow: hidden;
  font-size: 13px;

  th,
  td {
    padding: 12px 16px;
    border-bottom: 1px solid #212d3c;
    text-align: left;
    vertical-align: middle;
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  thead th {
    color: #fbfcfc;
    font-weight: 700;
    font-size: 13px;
    background: #131e2b;
  }
  td.name {
    color: #fbfcfc;
    width: 180px;
    white-space: nowrap;
  }
  td.val {
    color: #fbfcfc;
    word-break: break-all;
  }
  /* Zebra striping: row bg alternates secondary/primary inside a dimmed panel. */
  tbody tr {
    background: #172230;
  }
  tbody tr:nth-child(even) {
    background: #131e2b;
  }
  td.copy {
    width: 72px;
    text-align: right;
  }
`

const techHeading = css`
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 6px;
  color: #fbfcfc;
  display: inline-flex;
  align-items: center;
  gap: 6px;

  .q {
    color: #687a91;
    cursor: help;
  }
`

const techBlurb = css`
  color: #fbfcfc;
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 14px;
`

const copyBtn = css`
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 12px;
  border: 1px solid #4c83ee;
  border-radius: 6px;
  color: #4c83ee;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  &:hover {
    background: rgba(76, 131, 238, 0.1);
  }
`

const infoRow = css`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  color: #fbfcfc;
  font-size: 13px;
  border-bottom: 1px solid #212d3c;

  .check {
    color: #22bc66;
  }
`

function formatAddr(a: Address | undefined): string {
  if (!a) return ''
  return a.name ? `${a.name} <${a.address}>` : `<${a.address}>`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

function HtmlSource({ code }: { code: string }) {
  return (
    <Highlight theme={themes.vsDark} code={code} language="markup">
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${codeViewer} ${className}`}
          style={{ ...style, background: 'transparent' }}
        >
          {tokens.map((line, i) => {
            const { key: _lk, className: _lc, ...lineProps } = getLineProps({
              line,
            })
            return (
              <div key={i} className="row" {...lineProps}>
                <span className="ln">{i + 1}</span>
                <span className="code">
                  {line.map((token, ti) => {
                    const { key: _tk, ...tokenProps } = getTokenProps({
                      token,
                    })
                    return <span key={ti} {...tokenProps} />
                  })}
                </span>
              </div>
            )
          })}
        </pre>
      )}
    </Highlight>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard unavailable; swallow
    }
  }
  return (
    <button className={copyBtn} type="button" onClick={onClick}>
      {copied ? '✓' : 'Copy'}
    </button>
  )
}

/* ─── HTML Check (rule-engine results) ───────────────────────────────── */

const htmlCheckTop = css`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 28px;
  padding: 20px 24px 24px;
  margin-bottom: 16px;
  background: #131e2b;
  align-items: center;
`

const donutCss = css`
  width: 180px;
  height: 180px;
  position: relative;

  .center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .pct {
    font-size: 30px;
    font-weight: 700;
    color: ${success};
    line-height: 1;
  }
  .label {
    margin-top: 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: #fbfcfc;
    text-transform: uppercase;
  }
`

const familyTable = css`
  display: flex;
  flex-direction: column;
  font-size: 13px;
  max-width: 520px;

  .row {
    display: grid;
    grid-template-columns: 160px 56px 56px 56px 64px;
    align-items: center;
    column-gap: 14px;
    padding: 8px 4px;
    border-radius: 6px;
  }
  .row:hover {
    background: #131e2b;
  }
  .name {
    color: #fbfcfc;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .pct {
    font-weight: 700;
    text-align: right;
  }
  .pct[data-kind='supported'] {
    color: ${success};
  }
  .pct[data-kind='partial'] {
    color: #f5a524;
  }
  .pct[data-kind='no'] {
    color: ${danger};
  }
  /* Breakdown columns + Only/All button only show on row hover. */
  .row .pct[data-kind='partial'],
  .row .pct[data-kind='no'],
  .row .only {
    visibility: hidden;
  }
  .row:hover .pct[data-kind='partial'],
  .row:hover .pct[data-kind='no'],
  .row:hover .only {
    visibility: visible;
  }
  .checkbox {
    width: 14px;
    height: 14px;
    accent-color: ${accent};
  }
  .only {
    all: unset;
    cursor: pointer;
    padding: 4px 14px;
    border: 1px solid ${accent};
    border-radius: 999px;
    color: ${accent};
    font-size: 12px;
    font-weight: 600;
    text-align: center;
  }
  .only:hover {
    background: ${accentBgSoft};
  }
`

const filterStrip = css`
  display: flex;
  align-items: center;
  gap: 22px;
  margin-bottom: 14px;
  font-size: 13px;
  color: #fbfcfc;

  label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  input {
    accent-color: ${accent};
  }
  .count {
    color: #8b9aae;
  }
`

const htmlCheckIssueCss = css`
  background: #172230;
  border: 1px solid #212d3c;
  border-radius: 8px;
  padding: 18px 20px;
  margin-bottom: 12px;

  h3 {
    margin: 0 0 10px;
    color: #fbfcfc;
    font-size: 16px;
    font-weight: 600;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }
  .clients-row {
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .clients-row .label {
    color: #fbfcfc;
    font-weight: 600;
    font-size: 13px;
    padding-top: 4px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #fbfcfc;
    font-size: 13px;
  }
  .chip .dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .chip .dot[data-support='no'] {
    background: ${danger};
  }
  .chip .dot[data-support='partial'] {
    background: #f5a524;
  }
  .chip .dot[data-support='yes'] {
    background: ${success};
  }
  .chip .ver {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 4px;
    background: #212d3c;
    color: #fbfcfc;
    font-size: 11px;
    font-weight: 600;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }
  .chip .ver[data-noted='true'] {
    background: ${accent};
    color: #fbfcfc;
  }

  .lines {
    color: #8b9aae;
    font-size: 13px;
    margin-bottom: 8px;
  }
  .lines code {
    color: ${accent};
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }

  .toggle {
    all: unset;
    color: ${accent};
    font-size: 12px;
    cursor: pointer;
    margin-bottom: 8px;
    display: inline-block;
  }
  .toggle:hover {
    text-decoration: underline;
  }

  .notes {
    margin-top: 4px;
    color: #fbfcfc;
    font-size: 13px;
    line-height: 1.55;
  }
  .notes h4 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
  }
  .notes ol {
    margin: 0;
    padding-left: 22px;
  }
  .notes li {
    margin-bottom: 6px;
  }

  .reflink {
    margin-top: 12px;
    font-size: 12px;
  }
  .reflink a {
    color: ${accent};
    text-decoration: none;
  }
  .reflink a:hover {
    text-decoration: underline;
  }
`

const htmlCheckEmpty = css`
  background: #172230;
  border: 1px solid #212d3c;
  border-radius: 8px;
  padding: 24px;
  color: #8b9aae;
  font-size: 13px;
  text-align: center;
`

/**
 * Multi-segment donut: green for supported, orange for partial, red for no.
 * Each segment is a separate <circle> rotated to start where the previous
 * one ended — avoids the dashoffset/linecap quirks of a single shared
 * dasharray pattern when segments are tiny.
 */
function MarketSupportDonut({
  supported,
  partial,
  no,
}: {
  supported: number
  partial: number
  no: number
}) {
  const radius = 78
  const stroke = 14
  const C = 2 * Math.PI * radius
  const segs: Array<[number, string]> = [
    [supported, success],
    [partial, '#f5a524'],
    [no, danger],
  ]
  let elapsedPct = 0
  return (
    <div className={donutCss}>
      <svg viewBox="0 0 180 180" width="180" height="180">
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="#212d3c"
          strokeWidth={stroke}
        />
        {segs.map(([pct, color], i) => {
          if (pct <= 0) return null
          const length = (pct / 100) * C
          // Position the start of this segment at 12 o'clock + however far
          // the previous segments have advanced (in degrees).
          const rotation = -90 + (elapsedPct / 100) * 360
          elapsedPct += pct
          return (
            <circle
              key={i}
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={`${length} ${C}`}
              transform={`rotate(${rotation} 90 90)`}
            />
          )
        })}
      </svg>
      <div className="center">
        <span className="pct">{supported.toFixed(1)}%</span>
        <span className="label">Market support</span>
      </div>
    </div>
  )
}

/**
 * Aggregates a single client's affected versions into colored chips. Each
 * chip is a "support dot + version pill" matching Mailtrap's UI: red for
 * "no", amber for "partial", with note-number badges highlighted in accent
 * blue when that version had a note attached.
 */
function ClientChips({
  family,
  platform,
  display_name: name,
  support,
  versions,
  note_numbers: notes,
}: HtmlCheckClient) {
  // Pull the affected versions from {no:[], partial:[]} - "yes" versions
  // aren't worth surfacing inside an issue (they're already supported).
  const affected = [
    ...(versions?.no ?? []),
    ...(versions?.partial ?? []),
  ]
  const noteSet = new Set((notes ?? []).map((n) => String(n)))
  return (
    <span className="chip" key={`${family}-${platform}`}>
      <span className="dot" data-support={support} />
      {name}
      {affected.map((v) => (
        <span key={v} className="ver" data-noted={noteSet.has(v) || undefined}>
          {v}
        </span>
      ))}
    </span>
  )
}

interface HtmlCheckFilterState {
  enabledCategories: Record<ClientCategory, boolean>
  setEnabledCategories: React.Dispatch<
    React.SetStateAction<Record<ClientCategory, boolean>>
  >
  enabledFamilies: Record<string, boolean>
  setEnabledFamilies: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >
}

function HtmlCheck({
  hasHtml,
  report,
  err,
  filters,
}: {
  hasHtml: boolean
  report: HtmlCheckReport | null
  err: string | null
  filters: HtmlCheckFilterState
}) {
  const [showAllLines, setShowAllLines] = useState<Record<number, boolean>>({})
  const {
    enabledCategories,
    setEnabledCategories,
    enabledFamilies,
    setEnabledFamilies,
  } = filters

  if (!hasHtml) {
    return <div className={htmlCheckEmpty}>This message has no HTML body.</div>
  }
  if (err) {
    return <div className={htmlCheckEmpty}>Couldn't run HTML Check: {err}</div>
  }
  if (!report) {
    return <div className={htmlCheckEmpty}>Analyzing…</div>
  }
  if (report.status === 'no_html') {
    return <div className={htmlCheckEmpty}>This message has no HTML body.</div>
  }
  if (report.status === 'size_limit_exceeded') {
    const mb = (report.limit / 1024 / 1024).toFixed(0)
    return (
      <div className={htmlCheckEmpty}>
        HTML body is larger than {mb}MB — analysis skipped.
      </div>
    )
  }
  if (report.status === 'error') {
    return <div className={htmlCheckEmpty}>{report.msg}</div>
  }

  const enabledCats = (
    Object.keys(enabledCategories) as ClientCategory[]
  ).filter((c) => enabledCategories[c])

  // Filter visible issues by category + family checkboxes. An issue with
  // zero remaining clients after filtering gets dropped from the list.
  const visibleIssues = report.issues
    .map((issue) => ({
      ...issue,
      clients: issue.clients.filter((c) =>
        clientPassesFilters(c, enabledCats, enabledFamilies),
      ),
    }))
    .filter((issue) => issue.clients.length > 0)

  const totalsByCategory = report.families.reduce(
    (acc, f) => {
      acc.desktop += f.version_counts.desktop
      acc.mobile += f.version_counts.mobile
      acc.web += f.version_counts.web
      return acc
    },
    { desktop: 0, mobile: 0, web: 0 },
  )

  // Per-family support stats: counts UNIQUE affected versions
  // per (family, enabled categories), divides by total versions in those
  // categories. A version that's hit by 5 rules counts once, not 5x. A
  // version flagged both "no" and "partial" only counts as "no".
  const familyStats = filteredFamilySupportStats(
    report.issues,
    report.families,
    enabledCats,
  )
  const market = filteredMarketShareInfo(
    familyStats,
    report.families,
    enabledFamilies,
  )

  return (
    <>
      <div className={htmlCheckTop}>
        <MarketSupportDonut
          supported={market.supported}
          partial={market.partial}
          no={market.no}
        />
        <div>
          <div className={filterStrip}>
            {(['desktop', 'mobile', 'web'] as const).map((cat) => (
              <label key={cat}>
                <input
                  type="checkbox"
                  checked={enabledCategories[cat]}
                  onChange={(e) =>
                    setEnabledCategories({
                      ...enabledCategories,
                      [cat]: e.target.checked,
                    })
                  }
                />
                <span style={{ textTransform: 'capitalize' }}>{cat}</span>{' '}
                <span className="count">({totalsByCategory[cat]})</span>
              </label>
            ))}
          </div>
          <div className={familyTable}>
            {report.families.map((f) => {
              const stats = familyStats[f.family] ?? {
                supported: 100,
                partial: 0,
                no: 0,
              }
              // The button toggles between "Only" (solo-select this family)
              // and "All" (re-enable every family). It shows "All" iff this
              // row is currently the *sole* enabled family — clicking again
              // is the natural way to undo an "Only" pick.
              const enabledCount = report.families.reduce(
                (n, row) => (enabledFamilies[row.family] !== false ? n + 1 : n),
                0,
              )
              const isSoleEnabled =
                enabledCount === 1 && enabledFamilies[f.family] !== false
              const onClickAction = () => {
                const next: Record<string, boolean> = {}
                report.families.forEach((row) => {
                  next[row.family] = isSoleEnabled ? true : row.family === f.family
                })
                setEnabledFamilies(next)
              }
              return (
                <div key={f.family} className="row">
                  <label className="name">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={enabledFamilies[f.family] ?? true}
                      onChange={(e) =>
                        setEnabledFamilies({
                          ...enabledFamilies,
                          [f.family]: e.target.checked,
                        })
                      }
                    />
                    {f.label}
                  </label>
                  <span className="pct" data-kind="supported">
                    {stats.supported}%
                  </span>
                  <span className="pct" data-kind="partial">
                    {stats.partial}%
                  </span>
                  <span className="pct" data-kind="no">
                    {stats.no}%
                  </span>
                  <button
                    type="button"
                    className="only"
                    data-active={isSoleEnabled || undefined}
                    onClick={onClickAction}
                  >
                    {isSoleEnabled ? 'All' : 'Only'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {visibleIssues.length === 0 && (
        <div className={htmlCheckEmpty}>
          No issues for the current filters. Tick more clients above to widen
          the check.
        </div>
      )}

      {visibleIssues.map((issue, idx) => {
        const lineLimit = 6
        const showAll = showAllLines[idx] ?? false
        const visibleLines =
          showAll || issue.error_lines.length <= lineLimit
            ? issue.error_lines
            : issue.error_lines.slice(0, lineLimit)
        const noteEntries = Object.entries(issue.numbered_notes).sort(
          ([a], [b]) => Number(a) - Number(b),
        )
        return (
          <section key={idx} className={htmlCheckIssueCss}>
            <h3>{issue.rule_name}</h3>

            <div className="clients-row">
              <div className="label">Clients:</div>
              <div className="chips">
                {issue.clients.map((c) => (
                  <ClientChips key={`${c.family}-${c.platform}`} {...c} />
                ))}
              </div>
            </div>

            <div className="lines">
              Found on lines:{' '}
              {visibleLines.map((l, i) => (
                <span key={l}>
                  <code>{l}</code>
                  {i < visibleLines.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
            {issue.error_lines.length > lineLimit && (
              <button
                type="button"
                className="toggle"
                onClick={() =>
                  setShowAllLines({ ...showAllLines, [idx]: !showAll })
                }
              >
                {showAll
                  ? 'Show less'
                  : `Show all ${issue.error_lines.length} lines`}
              </button>
            )}

            {noteEntries.length > 0 && (
              <div className="notes">
                <h4>Notes:</h4>
                <ol>
                  {noteEntries.map(([n, text]) => (
                    <li key={n}>{text}</li>
                  ))}
                </ol>
              </div>
            )}

            {issue.url && (
              <div className="reflink">
                See full reference on{' '}
                <a href={issue.url} target="_blank" rel="noopener noreferrer">
                  caniemail.com
                </a>
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}

function TechInfo({ msg, headers }: { msg: Message; headers: HeadersMap }) {
  const smtpRows: [string, string][] = [
    ['MAIL FROM', msg.envelope_from || '(unknown)'],
    ...msg.envelope_to.map((to): [string, string] => ['RCPT TO', to]),
  ]

  const headerRows: [string, string][] = Object.entries(headers).flatMap(
    ([name, values]) => values.map((v): [string, string] => [name, v]),
  )

  const hasBcc = headerRows.some(([k]) => k.toLowerCase() === 'bcc')

  return (
    <>
      <section className={techSection}>
        <h3 className={techHeading}>
          SMTP Transaction Info
          <HelpIcon className="q" size={14} title="What is this?" />
        </h3>
        <p className={techBlurb}>
          This information is sent with the SMTP transaction itself and is not
          included in the email headers or body. It can be crucial for SMTP
          debugging but can't be found in common email tools.
        </p>
        <table className={techTable}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {smtpRows.map(([k, v], i) => (
              <tr key={`${k}-${i}`}>
                <td className="name">{k}</td>
                <td className="val">{v}</td>
                <td className="copy">
                  <CopyButton text={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={techSection}>
        <h3 className={techHeading}>
          Email Headers
          <HelpIcon className="q" size={14} title="What is this?" />
        </h3>
        <p className={techBlurb}>
          Original values of the headers. When sending a real email, headers
          can be altered by an email service provider or a mail transfer agent.
        </p>
        <table className={techTable}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {headerRows.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: '#687a91' }}>
                  (no headers)
                </td>
              </tr>
            )}
            {headerRows.map(([k, v], i) => (
              <tr key={`${k}-${i}`}>
                <td className="name">{k}</td>
                <td className="val">{v}</td>
                <td className="copy">
                  <CopyButton text={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!hasBcc && headerRows.length > 0 && (
          <div className={infoRow}>
            <SuccessFilledIcon className="check" size={14} />
            There is no Bcc information in this email message
          </div>
        )}
      </section>
    </>
  )
}

type ActionMode = 'default' | 'delete' | 'forward'
type Device = 'mobile' | 'tablet' | 'desktop'

/* Match Mailtrap's preview viewports: iPhone (375×667) and iPad (768×1024)
   in portrait. Desktop fills the remaining viewport height below tabs/toolbar
   so the rendered email gets as much vertical space as the screen offers. */
const DEVICE_SIZE: Record<Device, { width: string; height: string }> = {
  mobile: { width: '375px', height: '667px' },
  tablet: { width: '768px', height: '1024px' },
  desktop: { width: '100%', height: 'max(500px, calc(100vh - 260px))' },
}

function openInNewTab(content: string, mime: 'text/html' | 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  // Revoke after the new tab has had a chance to navigate.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function MessageView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [msg, setMsg] = useState<Message | null>(null)
  const [raw, setRaw] = useState<string>('')
  const [headers, setHeaders] = useState<HeadersMap>({})
  const [htmlCheck, setHtmlCheck] = useState<HtmlCheckReport | null>(null)
  const [htmlCheckErr, setHtmlCheckErr] = useState<string | null>(null)
  // HTML Check filter state lives at this level so the tab badge can read
  // the filter-aware `no`-support count alongside the panel itself.
  const [enabledCategories, setEnabledCategories] = useState<
    Record<ClientCategory, boolean>
  >({ desktop: true, mobile: true, web: true })
  const [enabledFamilies, setEnabledFamilies] = useState<Record<string, boolean>>(
    {},
  )
  // Initialize family filters from the report once it lands.
  useEffect(() => {
    if (htmlCheck?.status === 'success') {
      const init: Record<string, boolean> = {}
      htmlCheck.families.forEach((f) => {
        init[f.family] = true
      })
      setEnabledFamilies(init)
    }
  }, [htmlCheck])
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<ActionMode>('default')
  const [busy, setBusy] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [cloudSent, setCloudSent] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [forwardEmail, setForwardEmail] = useState('')
  const { state: cloudState } = useCloudConnection()
  const { state: relayState } = useRelayConnection()

  // Both per-message forward icons (cloud + SMTP relay) are always rendered
  // so the action's existence is discoverable. When unactionable they get
  // disabled + a tooltip explaining why — clicking does nothing but hover
  // tells the user what to fix.
  const cloudDisabledReason: string | null = !cloudState
    ? 'Loading…'
    : !cloudState.connected
      ? 'Connect to a Mailtrap sandbox first (cloud icon in the sidebar)'
      : cloudState.mirror_enabled
        ? 'Cloud mirror is on — every email is already sent automatically'
        : null

  const relayDisabledReason: string | null = !relayState
    ? 'Loading…'
    : !relayState.connected
      ? 'Configure an SMTP relay first (relay icon in the sidebar)'
      : relayState.auto_relay_enabled
        ? 'Auto-relay is on — every email is already forwarded automatically'
        : null

  useEffect(() => {
    if (!id) return
    setMsg(null)
    setError(null)
    setActiveTab(undefined)
    setMode('default')
    setDevice('desktop')
    setCloudSent(false)
    setActionError(null)
    setActionSuccess(null)
    setForwardEmail('')
    setHtmlCheck(null)
    setHtmlCheckErr(null)
    Promise.all([getMessage(id), getRawMessage(id), getHeaders(id)])
      .then(([m, r, h]) => {
        setMsg(m)
        setRaw(r)
        setHeaders(h)
        // Kick off HTML Check in the background once we know there's HTML —
        // the result drives the tab's issue-count badge, so it has to load
        // before the user opens the tab.
        if (m.html) {
          getHtmlCheck(id)
            .then(setHtmlCheck)
            .catch((e) => setHtmlCheckErr(extractApiError(e)))
        }
      })
      .catch((e) => setError(String(e)))
  }, [id])

  // Auto-dismiss the success strip after a few seconds — the user has
  // confirmation of the action and doesn't need it lingering.
  useEffect(() => {
    if (!actionSuccess) return
    const timer = window.setTimeout(() => setActionSuccess(null), 5000)
    return () => window.clearTimeout(timer)
  }, [actionSuccess])

  // Esc → back to the empty-state sandbox. Skipped while an inline mode
  // (delete-confirm or forward-form) is open — Esc cancels the mode first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Don't hijack Esc inside form inputs / textareas — let them clear.
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (mode !== 'default') {
        setMode('default')
        setForwardEmail('')
        return
      }
      navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, navigate])

  const onConfirmDelete = async () => {
    if (!id) return
    setBusy(true)
    setActionError(null)
    try {
      await deleteMessage(id)
      navigate('/', { replace: true })
    } catch (e) {
      setActionError(`Delete failed: ${extractApiError(e)}`)
      setBusy(false)
    }
  }

  const onSendForward = async () => {
    if (!id) return
    const to = forwardEmail.trim()
    if (!to) return
    setBusy(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await releaseMessage(id, [to])
      setMode('default')
      setForwardEmail('')
      setActionSuccess(
        relayState?.host
          ? `Forwarded to ${to} via ${relayState.host}`
          : `Forwarded to ${to}`,
      )
    } catch (e) {
      setActionError(`Forward failed: ${extractApiError(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onCloudForward = async () => {
    if (!id) return
    setBusy(true)
    setActionError(null)
    try {
      await sendMessageToCloud(id)
      setCloudSent(true)
    } catch (e) {
      setActionError(`Send to cloud failed: ${extractApiError(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onDownload = () => {
    if (!id) return
    // Browser honors Content-Disposition: attachment from ?dl=1.
    window.location.assign(rawMessageUrl(id, true))
  }

  if (error)
    return (
      <section className={wrap}>
        <p style={{ color: danger }}>Error: {error}</p>
      </section>
    )
  if (!msg)
    return (
      <section className={wrap}>
        <p style={{ color: '#687a91' }}>Loading…</p>
      </section>
    )

  return (
    <section className={wrap}>
      <header className={header}>
        <h2>{msg.subject || '(no subject)'}</h2>
        <div className="actions">
          {mode === 'default' && (
            <>
              <IconButton
                title={
                  relayDisabledReason ??
                  `Forward via SMTP relay (${relayState?.host})`
                }
                disabled={!!relayDisabledReason}
                onClick={() => setMode('forward')}
              >
                <ForwardIcon size={18} />
              </IconButton>
              <IconButton
                title={
                  cloudDisabledReason ??
                  (cloudSent
                    ? `Sent to Mailtrap sandbox ${cloudState?.sandbox_id}`
                    : `Send to Mailtrap sandbox ${cloudState?.sandbox_id}`)
                }
                onClick={onCloudForward}
                disabled={!!cloudDisabledReason || busy || cloudSent}
                style={cloudSent ? { color: success } : undefined}
              >
                {cloudSent ? (
                  <SuccessFilledIcon size={18} />
                ) : (
                  <CloudUploadIcon size={18} />
                )}
              </IconButton>
              <IconButton title="Download .eml" onClick={onDownload}>
                <DownloadIcon size={18} />
              </IconButton>
              <IconButton title="Delete email" onClick={() => setMode('delete')}>
                <DeleteIcon size={18} />
              </IconButton>
            </>
          )}
          {mode === 'delete' && (
            <div className={inlineBar}>
              <span>Delete this email?</span>
              <button
                className={pillBtn}
                data-variant="danger-text"
                type="button"
                onClick={onConfirmDelete}
                disabled={busy}
              >
                Confirm
              </button>
              <button
                className={pillBtn}
                data-variant="outline"
                type="button"
                onClick={() => setMode('default')}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          )}
          {mode === 'forward' && (
            <form
              className={inlineBar}
              onSubmit={(e) => {
                e.preventDefault()
                onSendForward()
              }}
            >
              <input
                type="email"
                required
                autoFocus
                placeholder="Forward to email"
                value={forwardEmail}
                onChange={(e) => setForwardEmail(e.target.value)}
                disabled={busy}
              />
              <button
                className={pillBtn}
                data-variant="primary"
                type="submit"
                disabled={busy || !forwardEmail.trim()}
              >
                Send
              </button>
              <button
                className={pillBtn}
                data-variant="outline"
                type="button"
                onClick={() => {
                  setMode('default')
                  setForwardEmail('')
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
        <div className="meta">
          <div>
            <span className="label">From:</span>
            <span className="val">{formatAddr(msg.from)}</span>
          </div>
          <div>
            <span className="label">To:</span>
            <span className="val">
              {msg.to.map((a) => formatAddr(a)).join(', ')}
            </span>
          </div>
          {msg.cc.length > 0 && (
            <div>
              <span className="label">Cc:</span>
              <span className="val">
                {msg.cc.map((a) => formatAddr(a)).join(', ')}
              </span>
            </div>
          )}
        </div>
        <div className="timesize">
          <div>{formatDate(msg.date)}, {formatSize(msg.size)}</div>
          {msg.tags[0] && (
            <div className="category" title={`Category: ${msg.tags[0]}`}>
              {msg.tags[0]}
            </div>
          )}
        </div>
        <button
          className="headersLink"
          type="button"
          onClick={() => setActiveTab('tech')}
        >
          Show Headers
        </button>
      </header>

      {actionError && (
        <div className={errorStrip} role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setActionError(null)}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className={successStrip} role="status">
          <SuccessFilledIcon size={14} />
          <span>{actionSuccess}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setActionSuccess(null)}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      )}

      <Tabs.Root
        value={activeTab ?? (msg.html ? 'html' : 'text')}
        onValueChange={setActiveTab}
      >
        <Tabs.List className={tabList}>
          {msg.html && (
            <Tabs.Trigger className={tabTrigger} value="html">
              HTML
            </Tabs.Trigger>
          )}
          {msg.html && (
            <Tabs.Trigger className={tabTrigger} value="source">
              HTML Source
            </Tabs.Trigger>
          )}
          <Tabs.Trigger className={tabTrigger} value="text">
            Text
          </Tabs.Trigger>
          <Tabs.Trigger className={tabTrigger} value="raw">
            Raw
          </Tabs.Trigger>
          {msg.html &&
            (() => {
              // Tab badge: count only issues that contain at least one
              // `no`-support client after filtering. Issues whose affected
              // clients are all "partial" (works but with caveats) don't
              // bump the counter.
              const noCount =
                htmlCheck?.status === 'success'
                  ? noSupportIssueCount(
                      htmlCheck.issues,
                      (Object.keys(enabledCategories) as ClientCategory[]).filter(
                        (c) => enabledCategories[c],
                      ),
                      enabledFamilies,
                    )
                  : 0
              return (
                <Tabs.Trigger className={tabTrigger} value="html-check">
                  HTML Check
                  {noCount > 0 && <span className={tabBadge}>{noCount}</span>}
                </Tabs.Trigger>
              )
            })()}
          <Tabs.Trigger className={tabTrigger} value="tech">
            Tech Info
          </Tabs.Trigger>
        </Tabs.List>

        {msg.html && (
          <Tabs.Content className={tabContent} value="html">
            <div className={deviceBar}>
              <IconButton
                variant="device"
                active={device === 'mobile'}
                title="Mobile preview"
                onClick={() => setDevice('mobile')}
              >
                <MobileIcon size={18} />
              </IconButton>
              <IconButton
                variant="device"
                active={device === 'tablet'}
                title="Tablet preview"
                onClick={() => setDevice('tablet')}
              >
                <TabletIcon size={18} />
              </IconButton>
              <IconButton
                variant="device"
                active={device === 'desktop'}
                title="Desktop preview"
                onClick={() => setDevice('desktop')}
              >
                <DesktopIcon size={18} />
              </IconButton>
              <IconButton
                variant="toolbar"
                className={popoutPosition}
                title="Open HTML in new tab"
                onClick={() => openInNewTab(msg.html, 'text/html')}
              >
                <ExternalLinkIcon size={14} />
              </IconButton>
            </div>
            <div className={iframeFrame} data-device={device}>
              <div
                className="frame"
                style={{
                  width: DEVICE_SIZE[device].width,
                  height: DEVICE_SIZE[device].height,
                  maxWidth: '100%',
                }}
              >
                <iframe
                  className={iframeCss}
                  sandbox=""
                  srcDoc={msg.html}
                  title="Message HTML"
                />
              </div>
            </div>
          </Tabs.Content>
        )}

        {msg.html && (
          <Tabs.Content className={tabContent} value="source">
            <HtmlSource code={msg.html} />
          </Tabs.Content>
        )}

        <Tabs.Content className={tabContent} value="text">
          <div className={previewWrap}>
            {msg.text && (
              <IconButton
                variant="toolbar"
                className={popoutPosition}
                title="Open text in new tab"
                onClick={() => openInNewTab(msg.text, 'text/plain')}
              >
                <ExternalLinkIcon size={14} />
              </IconButton>
            )}
            <pre className={preCss}>{msg.text || '(no plain-text body)'}</pre>
          </div>
        </Tabs.Content>

        <Tabs.Content className={tabContent} value="raw">
          <div className={previewWrap}>
            {raw && id && (
              <IconButton
                variant="toolbar"
                className={popoutPosition}
                title="Open raw in new tab"
                onClick={() =>
                  window.open(
                    rawMessageUrl(id),
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              >
                <ExternalLinkIcon size={14} />
              </IconButton>
            )}
            <pre className={preCss}>{raw || '(empty)'}</pre>
          </div>
        </Tabs.Content>

        {msg.html && id && (
          <Tabs.Content className={tabContent} value="html-check">
            <HtmlCheck
              hasHtml={!!msg.html}
              report={htmlCheck}
              err={htmlCheckErr}
              filters={{
                enabledCategories,
                setEnabledCategories,
                enabledFamilies,
                setEnabledFamilies,
              }}
            />
          </Tabs.Content>
        )}

        <Tabs.Content className={tabContent} value="tech">
          <TechInfo msg={msg} headers={headers} />
        </Tabs.Content>
      </Tabs.Root>
    </section>
  )
}
