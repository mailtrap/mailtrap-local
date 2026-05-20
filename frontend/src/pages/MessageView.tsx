import { useEffect, useState, type ReactNode } from 'react'
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

// Header is a 2-col / 3-row grid:
//   row 1: subject (col 1)            | actions (col 2)
//   row 2: meta (col 1)               | time + size + category (col 2)
//   row 3: "Show Headers" link (col 1)
const headerCss =
  'grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 items-start pb-4 border-b border-border-base'

const headerSubjectCss =
  'col-start-1 row-start-1 m-0 text-[22px] font-semibold leading-[1.21]'

const headerActionsCss = [
  'col-start-2 row-start-1 justify-self-end',
  'flex items-center justify-end gap-1',
].join(' ')

const headerMetaCss =
  'col-start-1 row-start-2 text-[13px] leading-[1.7] text-fg-muted'

const headerMetaLabelCss = 'mr-1.5 text-fg-muted'
const headerMetaValCss = 'text-fg'

const headerTimesizeCss = [
  'col-start-2 row-start-2 self-start',
  'flex flex-col items-end gap-1.5',
  'whitespace-nowrap text-right text-[13px] text-fg-muted',
].join(' ')

const headerCategoryCss = [
  'inline-block max-w-[200px] overflow-hidden text-ellipsis',
  'rounded-full bg-accent-medium px-2.5 py-0.5',
  'text-[11px] font-semibold leading-[1.6] text-accent',
].join(' ')

const headerHeadersLinkCss = [
  'col-start-1 row-start-3 justify-self-start',
  'cursor-pointer pt-0.5 text-[13px] text-accent hover:underline',
].join(' ')

function MetaRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      <span className={headerMetaLabelCss}>{label}:</span>
      <span className={headerMetaValCss}>{children}</span>
    </div>
  )
}

// Positioning override for the pop-out icon overlaying each tab content.
const popoutPosition = 'absolute top-0 right-0'

// Inline success strip (action feedback below the header).
const successStripCss = [
  'mt-2.5 flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.08]',
  'px-3 py-2 text-xs leading-[1.4] text-success',
].join(' ')

const successStripTextCss = 'flex-1 min-w-0'

const successStripDismissCss = [
  'inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center',
  'rounded text-success hover:bg-success/20',
].join(' ')

const errorStripCss = [
  'mt-2.5 flex items-center gap-2 rounded-md border border-danger-border bg-danger-soft',
  'px-3 py-2 text-xs leading-[1.4] text-danger',
].join(' ')

const errorStripTextCss = 'flex-1 min-w-0'

const errorStripDismissCss = [
  'inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center',
  'rounded text-danger hover:bg-danger-border',
].join(' ')

// Inline action bars (delete-confirm + forward-form) live inside the
// header's `.actions` slot. Layout only; the forward-form's input
// carries its own shape via inlineBarInputCss.
const inlineBarCss = 'flex items-center gap-2.5 text-[13px] text-fg'

const inlineBarInputCss = [
  'min-w-[220px] rounded-[7px] border border-border-base bg-surface-base',
  'px-3 py-[7px] text-[13px] text-fg outline-none',
  'placeholder:text-fg-muted focus:border-accent',
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

// Device-frame chrome around the HTML preview iframe. The frame
// reads its own `data-device` so device-driven styling lives on the
// element it actually styles.
const iframeFrameWrapCss = 'flex justify-center'

const iframeFrameCss = [
  'inline-block [box-sizing:content-box]',
  'rounded-none border-2 border-transparent bg-transparent p-0',
  'transition-[width,height,padding,border-radius,border-color,background-color] duration-[250ms] ease-out',
  // Mobile + tablet share the accent border + base background.
  'data-[device=mobile]:rounded-[32px] data-[device=mobile]:border-accent data-[device=mobile]:bg-surface-base data-[device=mobile]:px-2.5 data-[device=mobile]:py-3.5',
  'data-[device=tablet]:rounded-[18px] data-[device=tablet]:border-accent data-[device=tablet]:bg-surface-base data-[device=tablet]:p-3.5',
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

const codeViewerCss = [
  'm-0 rounded-[7px] border border-border-base bg-black/25 p-0',
  "font-['SF_Mono',Menlo,Consolas,monospace] text-xs leading-[1.55]",
  'min-h-[max(500px,calc(100vh-260px))] [box-sizing:border-box]',
].join(' ')

const codeViewerRowCss = 'grid grid-cols-[48px_1fr]'

const codeViewerLineNumCss = [
  'select-none px-2.5 pr-3 text-right text-[#4d5a6a]',
  'border-r border-border-base',
].join(' ')

const codeViewerCodeCss = 'px-3.5 whitespace-pre-wrap break-words'

const techSection =
  'mb-4 rounded-lg border border-border-base bg-surface-raised px-6 py-5'

// Two-column key/value table with zebra striping. Same shell wherever
// it's used; per-cell classes live alongside the cell elements below.
const techTableCss = [
  'w-full text-[13px] [border-collapse:separate] [border-spacing:0]',
  'overflow-hidden rounded-lg border border-border-base',
].join(' ')

const techTableCellCss =
  'p-3 px-4 text-left align-middle border-b border-border-base'

const techTableHeadCss = [
  techTableCellCss,
  'bg-surface-base text-[13px] font-bold text-fg',
].join(' ')

// The one legitimate descendant rule: removing the bottom border on the
// last row's cells. `:last-child` is structural and can only be detected
// in CSS, so a narrow `[&>tr:last-child>td]:` on the <tbody> is right —
// it's not a selector-hook, it's a position-driven rule.
const techTableBodyCss = '[&>tr:last-child>td]:border-b-0'

// Zebra striping via Tailwind's native `even:` variant on each <tr>.
const techTableRowCss = 'bg-surface-raised even:bg-surface-base'

const techTableNameCellCss = [
  techTableCellCss,
  'w-[180px] whitespace-nowrap text-fg',
].join(' ')

const techTableValCellCss = [techTableCellCss, 'text-fg break-all'].join(' ')

const techTableCopyCellCss = [
  techTableCellCss,
  'w-[72px] text-right',
].join(' ')

const techHeadingCss =
  'mb-1.5 m-0 inline-flex items-center gap-1.5 text-[15px] font-semibold text-fg'

// HelpIcon next to tech-section headings — muted color + help cursor.
const techHelpIconCss = 'cursor-help text-fg-muted'

const techBlurb = 'mb-3.5 m-0 text-[13px] leading-[1.6] text-fg'

const copyBtn = [
  'inline-flex cursor-pointer items-center justify-center rounded-md border border-accent',
  'px-3 py-[3px] text-xs font-medium text-accent',
  'hover:bg-accent/10',
].join(' ')

const infoRowCss = [
  'flex items-center justify-center gap-1.5 border-b border-border-base',
  'px-3 py-2.5 text-[13px] text-fg',
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
          className={`${codeViewerCss} ${className}`}
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
              <div key={i} className={codeViewerRowCss} {...lineProps}>
                <span className={codeViewerLineNumCss}>{i + 1}</span>
                <span className={codeViewerCodeCss}>
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

const donutCss = 'relative h-[180px] w-[180px]'

const donutCenterCss = [
  'pointer-events-none absolute inset-0',
  'flex flex-col items-center justify-center',
].join(' ')

const donutPctCss = 'text-[30px] font-bold leading-none text-success'

const donutLabelCss =
  'mt-1.5 text-[10px] font-bold tracking-[0.18em] text-fg uppercase'

// Per-family support breakdown table. Hover reveals the partial/no
// percentages and the Only/All toggle — implemented via `group` on the
// row + `group-hover:visible` on the revealable children.
const familyTableCss = 'flex max-w-[520px] flex-col text-[13px]'

const familyRowCss = [
  'group grid grid-cols-[160px_56px_56px_56px_64px] items-center',
  'gap-x-3.5 rounded-md px-1 py-2',
  'hover:bg-surface-base',
].join(' ')

const familyNameCss = 'inline-flex items-center gap-2.5 text-fg'

const familyCheckboxCss = 'h-3.5 w-3.5 [accent-color:var(--color-accent)]'

const familyPctBaseCss = 'text-right font-bold'

const familyPctSupportedCss = `${familyPctBaseCss} text-success`

const familyPctPartialCss = `${familyPctBaseCss} invisible text-[#f5a524] group-hover:visible`

const familyPctNoCss = `${familyPctBaseCss} invisible text-danger group-hover:visible`

const familyOnlyCss = [
  'invisible cursor-pointer rounded-full border border-accent',
  'px-3.5 py-1 text-center text-xs font-semibold text-accent',
  'hover:bg-accent-soft group-hover:visible',
].join(' ')

const filterStripCss =
  'mb-3.5 flex items-center gap-[22px] text-[13px] text-fg'

const filterStripLabelCss = 'inline-flex cursor-pointer items-center gap-1.5'

const filterStripCheckboxCss = '[accent-color:var(--color-accent)]'

const filterStripCountCss = 'text-fg-icon'

// Per-rule issue card. The chip rows visualize per-client support, with
// support dots colored by `data-support` and noted versions highlighted
// by `data-noted` — both rendered as Tailwind data-attribute variants
// on the element they describe.
const htmlCheckIssueCss =
  'mb-3 rounded-lg border border-border-base bg-surface-raised p-5 px-5 py-4'

const htmlCheckIssueTitleCss = [
  'mt-0 mb-2.5 text-base font-semibold text-fg',
  "font-['SF_Mono',Menlo,Consolas,monospace]",
].join(' ')

const htmlCheckClientsRowCss = 'mb-3 grid grid-cols-[64px_1fr] gap-3'

const htmlCheckClientsLabelCss = 'pt-1 text-[13px] font-semibold text-fg'

const htmlCheckChipsCss = 'flex flex-wrap items-center gap-x-3.5 gap-y-1.5'

const htmlCheckChipCss = 'inline-flex items-center gap-1.5 text-[13px] text-fg'

const htmlCheckDotCss = [
  'inline-block h-[9px] w-[9px] rounded-full',
  'data-[support=no]:bg-danger',
  'data-[support=partial]:bg-[#f5a524]',
  'data-[support=yes]:bg-success',
].join(' ')

const htmlCheckVerCss = [
  'inline-flex h-[18px] min-w-[18px] items-center justify-center',
  'rounded bg-surface-hover px-[5px]',
  "font-['SF_Mono',Menlo,Consolas,monospace] text-[11px] font-semibold text-fg",
  'data-[noted=true]:bg-accent data-[noted=true]:text-fg',
].join(' ')

const htmlCheckLinesCss = 'mb-2 text-[13px] text-fg-icon'

const htmlCheckLinesCodeCss =
  "font-['SF_Mono',Menlo,Consolas,monospace] text-accent"

const htmlCheckToggleCss = [
  'mb-2 inline-block cursor-pointer text-xs text-accent',
  'hover:underline',
].join(' ')

const htmlCheckNotesCss = 'mt-1 text-[13px] leading-[1.55] text-fg'
const htmlCheckNotesHeadingCss = 'm-0 mb-1.5 text-[13px] font-semibold'
const htmlCheckNotesListCss = 'm-0 pl-[22px]'
const htmlCheckNotesItemCss = 'mb-1.5'

const htmlCheckReflinkCss = 'mt-3 text-xs'
const htmlCheckReflinkLinkCss = 'text-accent no-underline hover:underline'

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
      <div className={donutCenterCss}>
        <span className={donutPctCss}>{supported.toFixed(1)}%</span>
        <span className={donutLabelCss}>Market support</span>
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
    <span className={htmlCheckChipCss} key={`${family}-${platform}`}>
      <span className={htmlCheckDotCss} data-support={support} />
      {name}
      {affected.map((v) => (
        <span
          key={v}
          className={htmlCheckVerCss}
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
          <div className={filterStripCss}>
            {(['desktop', 'mobile', 'web'] as const).map((cat) => (
              <label key={cat} className={filterStripLabelCss}>
                <input
                  type="checkbox"
                  className={filterStripCheckboxCss}
                  checked={enabledCategories[cat]}
                  onChange={(e) =>
                    setEnabledCategories({
                      ...enabledCategories,
                      [cat]: e.target.checked,
                    })
                  }
                />
                <span className="capitalize">{cat}</span>{' '}
                <span className={filterStripCountCss}>
                  ({totalsByCategory[cat]})
                </span>
              </label>
            ))}
          </div>
          <div className={familyTableCss}>
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
                <div key={f.family} className={familyRowCss}>
                  <label className={familyNameCss}>
                    <input
                      type="checkbox"
                      className={familyCheckboxCss}
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
                  <span className={familyPctSupportedCss}>
                    {stats.supported}%
                  </span>
                  <span className={familyPctPartialCss}>{stats.partial}%</span>
                  <span className={familyPctNoCss}>{stats.no}%</span>
                  <button
                    type="button"
                    className={familyOnlyCss}
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
            <h3 className={htmlCheckIssueTitleCss}>{issue.rule_name}</h3>

            <div className={htmlCheckClientsRowCss}>
              <div className={htmlCheckClientsLabelCss}>Clients:</div>
              <div className={htmlCheckChipsCss}>
                {issue.clients.map((c) => (
                  <ClientChips key={`${c.family}-${c.platform}`} {...c} />
                ))}
              </div>
            </div>

            <div className={htmlCheckLinesCss}>
              Found on lines:{' '}
              {visibleLines.map((l, i) => (
                <span key={l}>
                  <code className={htmlCheckLinesCodeCss}>{l}</code>
                  {i < visibleLines.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
            {issue.error_lines.length > lineLimit && (
              <button
                type="button"
                className={htmlCheckToggleCss}
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
              <div className={htmlCheckNotesCss}>
                <h4 className={htmlCheckNotesHeadingCss}>Notes:</h4>
                <ol className={htmlCheckNotesListCss}>
                  {noteEntries.map(([n, text]) => (
                    <li key={n} className={htmlCheckNotesItemCss}>
                      {text}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {issue.url && (
              <div className={htmlCheckReflinkCss}>
                See full reference on{' '}
                <a
                  href={issue.url}
                  className={htmlCheckReflinkLinkCss}
                  target="_blank"
                  rel="noopener noreferrer"
                >
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
        <h3 className={techHeadingCss}>
          SMTP Transaction Info
          <HelpIcon
            className={techHelpIconCss}
            size={14}
            title="What is this?"
          />
        </h3>
        <p className={techBlurb}>
          This information is sent with the SMTP transaction itself and is not
          included in the email headers or body. It can be crucial for SMTP
          debugging but can't be found in common email tools.
        </p>
        <table className={techTableCss}>
          <thead>
            <tr>
              <th className={techTableHeadCss}>Name</th>
              <th className={techTableHeadCss}>Value</th>
              <th className={techTableHeadCss} />
            </tr>
          </thead>
          <tbody className={techTableBodyCss}>
            {smtpRows.map(([k, v], i) => (
              <tr key={`${k}-${i}`} className={techTableRowCss}>
                <td className={techTableNameCellCss}>{k}</td>
                <td className={techTableValCellCss}>{v}</td>
                <td className={techTableCopyCellCss}>
                  <CopyButton text={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={techSection}>
        <h3 className={techHeadingCss}>
          Email Headers
          <HelpIcon
            className={techHelpIconCss}
            size={14}
            title="What is this?"
          />
        </h3>
        <p className={techBlurb}>
          Original values of the headers. When sending a real email, headers
          can be altered by an email service provider or a mail transfer
          agent.
        </p>
        <table className={techTableCss}>
          <thead>
            <tr>
              <th className={techTableHeadCss}>Name</th>
              <th className={techTableHeadCss}>Value</th>
              <th className={techTableHeadCss} />
            </tr>
          </thead>
          <tbody className={techTableBodyCss}>
            {headerRows.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className={`${techTableCellCss} text-fg-muted`}
                >
                  (no headers)
                </td>
              </tr>
            )}
            {headerRows.map(([k, v], i) => (
              <tr key={`${k}-${i}`} className={techTableRowCss}>
                <td className={techTableNameCellCss}>{k}</td>
                <td className={techTableValCellCss}>{v}</td>
                <td className={techTableCopyCellCss}>
                  <CopyButton text={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!hasBcc && headerRows.length > 0 && (
          <div className={infoRowCss}>
            <SuccessFilledIcon className="text-success" size={14} />
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
      <header className={headerCss}>
        <h2 className={headerSubjectCss}>{msg.subject || '(no subject)'}</h2>
        <div className={headerActionsCss}>
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
            <div className={inlineBarCss}>
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
              className={inlineBarCss}
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
                className={inlineBarInputCss}
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
        <div className={headerMetaCss}>
          <MetaRow label="From">{formatAddr(msg.from)}</MetaRow>
          <MetaRow label="To">
            {msg.to.map((a) => formatAddr(a)).join(', ')}
          </MetaRow>
          {msg.cc.length > 0 && (
            <MetaRow label="Cc">
              {msg.cc.map((a) => formatAddr(a)).join(', ')}
            </MetaRow>
          )}
        </div>
        <div className={headerTimesizeCss}>
          <div>
            {formatDate(msg.date)}, {formatSize(msg.size)}
          </div>
          {msg.tags[0] && (
            <div
              className={headerCategoryCss}
              title={`Category: ${msg.tags[0]}`}
            >
              {msg.tags[0]}
            </div>
          )}
        </div>
        <button
          className={headerHeadersLinkCss}
          type="button"
          onClick={() => setActiveTab('tech')}
        >
          Show Headers
        </button>
      </header>

      {actionError && (
        <div className={errorStripCss} role="alert">
          <span className={errorStripTextCss}>{actionError}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className={errorStripDismissCss}
            onClick={() => setActionError(null)}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className={successStripCss} role="status">
          <SuccessFilledIcon size={14} />
          <span className={successStripTextCss}>{actionSuccess}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className={successStripDismissCss}
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
            <div className={iframeFrameWrapCss}>
              <div
                className={iframeFrameCss}
                data-device={device}
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
