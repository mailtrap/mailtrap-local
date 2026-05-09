import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { extractApiError } from '../api/client'

const wrap = 'm-0'

// Header is a 2-col / 3-row grid: subject + actions, meta + time/category,
// "Show Headers" link spanning row 3. Descendant utilities decorate the
// nested children so the JSX below stays clean.
const header = [
  'grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 items-start pb-4',
  'border-b border-border-base',
  '[&_h2]:col-start-1 [&_h2]:row-start-1 [&_h2]:m-0 [&_h2]:text-[22px] [&_h2]:font-semibold [&_h2]:leading-[1.21]',
  '[&_.actions]:col-start-2 [&_.actions]:row-start-1 [&_.actions]:justify-self-end',
  '[&_.actions]:flex [&_.actions]:items-center [&_.actions]:justify-end [&_.actions]:gap-1',
  '[&_.meta]:col-start-1 [&_.meta]:row-start-2 [&_.meta]:text-[13px] [&_.meta]:leading-[1.7] [&_.meta]:text-fg-muted',
  '[&_.meta_.label]:mr-1.5 [&_.meta_.label]:text-fg-muted',
  '[&_.meta_.val]:text-fg',
  '[&_.timesize]:col-start-2 [&_.timesize]:row-start-2 [&_.timesize]:self-start',
  '[&_.timesize]:flex [&_.timesize]:flex-col [&_.timesize]:items-end [&_.timesize]:gap-1.5',
  '[&_.timesize]:whitespace-nowrap [&_.timesize]:text-right [&_.timesize]:text-[13px] [&_.timesize]:text-fg-muted',
  '[&_.timesize_.category]:inline-block [&_.timesize_.category]:max-w-[200px] [&_.timesize_.category]:overflow-hidden [&_.timesize_.category]:text-ellipsis',
  '[&_.timesize_.category]:rounded-full [&_.timesize_.category]:bg-accent-medium [&_.timesize_.category]:px-2.5 [&_.timesize_.category]:py-0.5',
  '[&_.timesize_.category]:text-[11px] [&_.timesize_.category]:font-semibold [&_.timesize_.category]:leading-[1.6] [&_.timesize_.category]:text-accent',
  '[&_.headersLink]:col-start-1 [&_.headersLink]:row-start-3 [&_.headersLink]:justify-self-start',
  '[&_.headersLink]:cursor-pointer [&_.headersLink]:pt-0.5 [&_.headersLink]:text-[13px] [&_.headersLink]:text-accent',
  '[&_.headersLink:hover]:underline',
].join(' ')

// Positioning override for the pop-out icon overlaying each tab content.
const popoutPosition = 'absolute top-0 right-0'

// Inline success / error strips (action feedback below the header).
const successStrip = [
  'mt-2.5 flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.08]',
  'px-3 py-2 text-xs leading-[1.4] text-success',
  '[&_span]:flex-1 [&_span]:min-w-0',
  '[&_button]:inline-flex [&_button]:h-[18px] [&_button]:w-[18px] [&_button]:cursor-pointer',
  '[&_button]:items-center [&_button]:justify-center [&_button]:rounded [&_button]:text-success',
  '[&_button:hover]:bg-success/20',
].join(' ')

const errorStrip = [
  'mt-2.5 flex items-center gap-2 rounded-md border border-danger-border bg-danger-soft',
  'px-3 py-2 text-xs leading-[1.4] text-danger',
  '[&_span]:flex-1 [&_span]:min-w-0',
  '[&_button]:inline-flex [&_button]:h-[18px] [&_button]:w-[18px] [&_button]:cursor-pointer',
  '[&_button]:items-center [&_button]:justify-center [&_button]:rounded [&_button]:text-danger',
  '[&_button:hover]:bg-danger-border',
].join(' ')

// Inline action bars (delete-confirm + forward-form) live inside the
// header's `.actions` slot.
const inlineBar = [
  'flex items-center gap-2.5 text-[13px] text-fg',
  '[&_input]:rounded-[7px] [&_input]:border [&_input]:border-border-base [&_input]:bg-surface-base',
  '[&_input]:px-3 [&_input]:py-[7px] [&_input]:text-[13px] [&_input]:text-fg [&_input]:outline-none',
  '[&_input]:min-w-[220px]',
  '[&_input::placeholder]:text-fg-muted',
  '[&_input:focus]:border-accent',
].join(' ')

// Variant-driven pill button — same shape as dialogStyles.btn but slightly
// chunkier (used inline beside the message header).
const pillBtn = [
  'inline-flex cursor-pointer items-center justify-center rounded-[7px] border border-transparent',
  'px-4 py-1.5 text-[13px] font-semibold',
  'data-[variant=primary]:bg-accent data-[variant=primary]:text-fg',
  'data-[variant=primary]:hover:bg-accent-hover',
  'data-[variant=danger-text]:border-danger data-[variant=danger-text]:text-danger',
  'data-[variant=danger-text]:hover:bg-danger-soft',
  'data-[variant=outline]:border-accent data-[variant=outline]:text-accent',
  'data-[variant=outline]:hover:bg-accent-soft',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

const deviceBar = 'relative flex justify-center gap-1 pt-2 pb-3'

const previewWrap = 'relative'

// Device-frame chrome around the HTML preview iframe. Frame stays
// inline-block in every mode so switching devices animates in place.
const iframeFrame = [
  'flex justify-center',
  '[&_.frame]:inline-block [&_.frame]:[box-sizing:content-box]',
  '[&_.frame]:rounded-none [&_.frame]:border-2 [&_.frame]:border-transparent [&_.frame]:bg-transparent [&_.frame]:p-0',
  '[&_.frame]:transition-[width,height,padding,border-radius,border-color,background-color] [&_.frame]:duration-[250ms] [&_.frame]:ease-out',
  // Mobile + tablet share the accent border + base background.
  '[&[data-device=mobile]_.frame]:border-accent [&[data-device=mobile]_.frame]:bg-surface-base',
  '[&[data-device=mobile]_.frame]:rounded-[32px] [&[data-device=mobile]_.frame]:px-2.5 [&[data-device=mobile]_.frame]:py-3.5',
  '[&[data-device=tablet]_.frame]:border-accent [&[data-device=tablet]_.frame]:bg-surface-base',
  '[&[data-device=tablet]_.frame]:rounded-[18px] [&[data-device=tablet]_.frame]:p-3.5',
].join(' ')

const tabList = 'mt-4 flex gap-[18px] border-b border-border-base p-0'

const tabBadge = [
  'ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full',
  'bg-danger px-1.5 align-middle text-[11px] font-bold leading-none text-fg',
].join(' ')

// Each tab trigger gets its own underline indicator via ::after when
// data-state="active" (Radix sets it).
const tabTrigger = [
  'relative cursor-pointer py-2.5 leading-none text-sm font-medium font-sans text-fg-icon',
  'hover:text-fg',
  'data-[state=active]:text-fg',
  "data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent",
].join(' ')

const tabContent = 'pt-4'

const iframeCss =
  'block h-full w-full rounded-[7px] border border-border-base bg-white'

// Plain-text + raw bodies. Match the desktop iframe min-height so short
// payloads still fill the viewport.
const preCss = [
  'rounded-[7px] border border-border-base bg-black/20 p-3 text-fg',
  "font-['SF_Mono',Menlo,Consolas,monospace] text-xs leading-[1.5]",
  'whitespace-pre-wrap break-words',
  'min-h-[max(500px,calc(100vh-260px))] [box-sizing:border-box]',
].join(' ')

const codeViewer = [
  'm-0 rounded-[7px] border border-border-base bg-black/25 p-0',
  "font-['SF_Mono',Menlo,Consolas,monospace] text-xs leading-[1.55]",
  'min-h-[max(500px,calc(100vh-260px))] [box-sizing:border-box]',
  '[&_.row]:grid [&_.row]:grid-cols-[48px_1fr]',
  '[&_.ln]:select-none [&_.ln]:px-2.5 [&_.ln]:pr-3 [&_.ln]:text-right [&_.ln]:text-[#4d5a6a]',
  '[&_.ln]:border-r [&_.ln]:border-border-base',
  '[&_.code]:px-3.5 [&_.code]:whitespace-pre-wrap [&_.code]:break-words',
].join(' ')

const techSection =
  'mb-4 rounded-lg border border-border-base bg-surface-raised px-6 py-5'

// Two-column key/value table with zebra striping. Same shell wherever
// it's used.
const techTable = [
  'w-full text-[13px] [border-collapse:separate] [border-spacing:0]',
  'overflow-hidden rounded-lg border border-border-base',
  '[&_th]:p-3 [&_th]:px-4 [&_th]:text-left [&_th]:align-middle [&_th]:border-b [&_th]:border-border-base',
  '[&_td]:p-3 [&_td]:px-4 [&_td]:text-left [&_td]:align-middle [&_td]:border-b [&_td]:border-border-base',
  '[&_tbody_tr:last-child_td]:border-b-0',
  '[&_thead_th]:bg-surface-base [&_thead_th]:text-[13px] [&_thead_th]:font-bold [&_thead_th]:text-fg',
  '[&_td.name]:w-[180px] [&_td.name]:whitespace-nowrap [&_td.name]:text-fg',
  '[&_td.val]:text-fg [&_td.val]:break-all',
  '[&_tbody_tr]:bg-surface-raised',
  '[&_tbody_tr:nth-child(even)]:bg-surface-base',
  '[&_td.copy]:w-[72px] [&_td.copy]:text-right',
].join(' ')

const techHeading = [
  'mb-1.5 m-0 inline-flex items-center gap-1.5 text-[15px] font-semibold text-fg',
  '[&_.q]:cursor-help [&_.q]:text-fg-muted',
].join(' ')

const techBlurb = 'mb-3.5 m-0 text-[13px] leading-[1.6] text-fg'

const copyBtn = [
  'inline-flex cursor-pointer items-center justify-center rounded-md border border-accent',
  'px-3 py-[3px] text-xs font-medium text-accent',
  'hover:bg-accent/10',
].join(' ')

const infoRow = [
  'flex items-center justify-center gap-1.5 border-b border-border-base',
  'px-3 py-2.5 text-[13px] text-fg',
  '[&_.check]:text-success',
].join(' ')

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
            const {
              key: _lk,
              className: _lc,
              ...lineProps
            } = getLineProps({
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

const htmlCheckTop = [
  'mb-4 grid grid-cols-[auto_1fr] items-center gap-7',
  'rounded-none bg-surface-base px-6 pt-5 pb-6',
].join(' ')

const donutCss = [
  'relative h-[180px] w-[180px]',
  '[&_.center]:pointer-events-none [&_.center]:absolute [&_.center]:inset-0',
  '[&_.center]:flex [&_.center]:flex-col [&_.center]:items-center [&_.center]:justify-center',
  '[&_.pct]:text-[30px] [&_.pct]:font-bold [&_.pct]:leading-none [&_.pct]:text-success',
  '[&_.label]:mt-1.5 [&_.label]:text-[10px] [&_.label]:font-bold [&_.label]:tracking-[0.18em] [&_.label]:text-fg [&_.label]:uppercase',
].join(' ')

// Per-family support breakdown table. Hover reveals the partial/no
// percentages and the Only/All toggle.
const familyTable = [
  'flex max-w-[520px] flex-col text-[13px]',
  '[&_.row]:grid [&_.row]:grid-cols-[160px_56px_56px_56px_64px] [&_.row]:items-center',
  '[&_.row]:gap-x-3.5 [&_.row]:rounded-md [&_.row]:px-1 [&_.row]:py-2',
  '[&_.row:hover]:bg-surface-base',
  '[&_.name]:inline-flex [&_.name]:items-center [&_.name]:gap-2.5 [&_.name]:text-fg',
  '[&_.pct]:text-right [&_.pct]:font-bold',
  '[&_.pct[data-kind=supported]]:text-success',
  '[&_.pct[data-kind=partial]]:text-[#f5a524]',
  '[&_.pct[data-kind=no]]:text-danger',
  '[&_.row_.pct[data-kind=partial]]:invisible',
  '[&_.row_.pct[data-kind=no]]:invisible',
  '[&_.row_.only]:invisible',
  '[&_.row:hover_.pct[data-kind=partial]]:visible',
  '[&_.row:hover_.pct[data-kind=no]]:visible',
  '[&_.row:hover_.only]:visible',
  '[&_.checkbox]:h-3.5 [&_.checkbox]:w-3.5 [&_.checkbox]:[accent-color:var(--color-accent)]',
  '[&_.only]:cursor-pointer [&_.only]:rounded-full [&_.only]:border [&_.only]:border-accent',
  '[&_.only]:px-3.5 [&_.only]:py-1 [&_.only]:text-center [&_.only]:text-xs [&_.only]:font-semibold [&_.only]:text-accent',
  '[&_.only:hover]:bg-accent-soft',
].join(' ')

const filterStrip = [
  'mb-3.5 flex items-center gap-[22px] text-[13px] text-fg',
  '[&_label]:inline-flex [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-1.5',
  '[&_input]:[accent-color:var(--color-accent)]',
  '[&_.count]:text-fg-icon',
].join(' ')

// Per-rule issue card. The chip rows visualize per-client support, with
// support dots colored by `data-support`.
const htmlCheckIssueCss = [
  'mb-3 rounded-lg border border-border-base bg-surface-raised p-5 px-5 py-4',
  "[&_h3]:mt-0 [&_h3]:mb-2.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-fg [&_h3]:font-['SF_Mono',Menlo,Consolas,monospace]",
  '[&_.clients-row]:mb-3 [&_.clients-row]:grid [&_.clients-row]:grid-cols-[64px_1fr] [&_.clients-row]:gap-3',
  '[&_.clients-row_.label]:pt-1 [&_.clients-row_.label]:text-[13px] [&_.clients-row_.label]:font-semibold [&_.clients-row_.label]:text-fg',
  '[&_.chips]:flex [&_.chips]:flex-wrap [&_.chips]:items-center [&_.chips]:gap-x-3.5 [&_.chips]:gap-y-1.5',
  '[&_.chip]:inline-flex [&_.chip]:items-center [&_.chip]:gap-1.5 [&_.chip]:text-[13px] [&_.chip]:text-fg',
  '[&_.chip_.dot]:inline-block [&_.chip_.dot]:h-[9px] [&_.chip_.dot]:w-[9px] [&_.chip_.dot]:rounded-full',
  '[&_.chip_.dot[data-support=no]]:bg-danger',
  '[&_.chip_.dot[data-support=partial]]:bg-[#f5a524]',
  '[&_.chip_.dot[data-support=yes]]:bg-success',
  '[&_.chip_.ver]:inline-flex [&_.chip_.ver]:h-[18px] [&_.chip_.ver]:min-w-[18px] [&_.chip_.ver]:items-center [&_.chip_.ver]:justify-center',
  '[&_.chip_.ver]:rounded [&_.chip_.ver]:bg-surface-hover [&_.chip_.ver]:px-[5px]',
  "[&_.chip_.ver]:font-['SF_Mono',Menlo,Consolas,monospace] [&_.chip_.ver]:text-[11px] [&_.chip_.ver]:font-semibold [&_.chip_.ver]:text-fg",
  '[&_.chip_.ver[data-noted=true]]:bg-accent [&_.chip_.ver[data-noted=true]]:text-fg',
  '[&_.lines]:mb-2 [&_.lines]:text-[13px] [&_.lines]:text-fg-icon',
  "[&_.lines_code]:font-['SF_Mono',Menlo,Consolas,monospace] [&_.lines_code]:text-accent",
  '[&_.toggle]:mb-2 [&_.toggle]:inline-block [&_.toggle]:cursor-pointer [&_.toggle]:text-xs [&_.toggle]:text-accent',
  '[&_.toggle:hover]:underline',
  '[&_.notes]:mt-1 [&_.notes]:text-[13px] [&_.notes]:leading-[1.55] [&_.notes]:text-fg',
  '[&_.notes_h4]:m-0 [&_.notes_h4]:mb-1.5 [&_.notes_h4]:text-[13px] [&_.notes_h4]:font-semibold',
  '[&_.notes_ol]:m-0 [&_.notes_ol]:pl-[22px]',
  '[&_.notes_li]:mb-1.5',
  '[&_.reflink]:mt-3 [&_.reflink]:text-xs',
  '[&_.reflink_a]:text-accent [&_.reflink_a]:no-underline',
  '[&_.reflink_a:hover]:underline',
].join(' ')

const htmlCheckEmpty = [
  'rounded-lg border border-border-base bg-surface-raised p-6',
  'text-center text-[13px] text-fg-icon',
].join(' ')

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
  // Use the design tokens directly for the segment colours so a future
  // theme change picks them up.
  const segs: Array<[number, string]> = [
    [supported, 'var(--color-success)'],
    [partial, '#f5a524'],
    [no, 'var(--color-danger)'],
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
  const affected = [...(versions?.no ?? []), ...(versions?.partial ?? [])]
  const noteSet = new Set((notes ?? []).map((n) => String(n)))
  return (
    <span className="chip" key={`${family}-${platform}`}>
      <span className="dot" data-support={support} />
      {name}
      {affected.map((v) => (
        <span
          key={v}
          className="ver"
          data-noted={noteSet.has(v) || undefined}
        >
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
    return (
      <div className={htmlCheckEmpty}>Couldn't run HTML Check: {err}</div>
    )
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
                <span className="capitalize">{cat}</span>{' '}
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
                (n, row) =>
                  enabledFamilies[row.family] !== false ? n + 1 : n,
                0,
              )
              const isSoleEnabled =
                enabledCount === 1 && enabledFamilies[f.family] !== false
              const onClickAction = () => {
                const next: Record<string, boolean> = {}
                report.families.forEach((row) => {
                  next[row.family] = isSoleEnabled
                    ? true
                    : row.family === f.family
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
          can be altered by an email service provider or a mail transfer
          agent.
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
                <td colSpan={3} className="text-fg-muted">
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
  const [enabledFamilies, setEnabledFamilies] = useState<
    Record<string, boolean>
  >({})
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
        <p className="text-danger">Error: {error}</p>
      </section>
    )
  if (!msg)
    return (
      <section className={wrap}>
        <p className="text-fg-muted">Loading…</p>
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
                className={cloudSent ? 'text-success' : undefined}
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
              <IconButton
                title="Delete email"
                onClick={() => setMode('delete')}
              >
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
          <div>
            {formatDate(msg.date)}, {formatSize(msg.size)}
          </div>
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
                      (
                        Object.keys(enabledCategories) as ClientCategory[]
                      ).filter((c) => enabledCategories[c]),
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
