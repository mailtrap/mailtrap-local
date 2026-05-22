import { useState } from 'react'
import {
  type ClientCategory,
  type HtmlCheckClient,
  type HtmlCheckReport,
} from '../api/messages'
import {
  filteredFamilySupportStats,
  filteredMarketShareInfo,
  clientPassesFilters,
} from '../lib/htmlCheckStats'
import { EmptyCard } from './EmptyCard'
import Panel from './Panel'

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

const familyPctPartialCss = `${familyPctBaseCss} invisible text-warning group-hover:visible`

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

// Per-rule issue card lives inside a <Panel>. The chip rows visualize
// per-client support, with support dots colored by `data-support` and
// noted versions highlighted by `data-noted` — both rendered as Tailwind
// data-attribute variants on the element they describe.

const htmlCheckIssueTitleCss = [
  'mt-0 mb-2.5 text-base font-semibold text-fg',
  'font-mono',
].join(' ')

const htmlCheckClientsRowCss = 'mb-3 grid grid-cols-[64px_1fr] gap-3'

const htmlCheckClientsLabelCss = 'pt-1 text-[13px] font-semibold text-fg'

const htmlCheckChipsCss = 'flex flex-wrap items-center gap-x-3.5 gap-y-1.5'

const htmlCheckChipCss = 'inline-flex items-center gap-1.5 text-[13px] text-fg'

const htmlCheckDotCss = [
  'inline-block h-[9px] w-[9px] rounded-full',
  'data-[support=no]:bg-danger',
  'data-[support=partial]:bg-warning',
  'data-[support=yes]:bg-success',
].join(' ')

const htmlCheckVerCss = [
  'inline-flex h-[18px] min-w-[18px] items-center justify-center',
  'rounded bg-surface-hover px-[5px]',
  'font-mono text-[11px] font-semibold text-fg',
  'data-[noted=true]:bg-accent data-[noted=true]:text-fg',
].join(' ')

const htmlCheckLinesCss = 'mb-2 text-[13px] text-fg-icon'

const htmlCheckLinesCodeCss = 'font-mono text-accent'

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
    [partial, 'var(--color-warning)'],
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

export interface HtmlCheckFilterState {
  enabledCategories: Record<ClientCategory, boolean>
  setEnabledCategories: React.Dispatch<
    React.SetStateAction<Record<ClientCategory, boolean>>
  >
  enabledFamilies: Record<string, boolean>
  setEnabledFamilies: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >
}

export default function HtmlCheck({
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
    return <EmptyCard>This message has no HTML body.</EmptyCard>
  }
  if (err) {
    return <EmptyCard>Couldn't run HTML Check: {err}</EmptyCard>
  }
  if (!report) {
    return <EmptyCard>Analyzing…</EmptyCard>
  }
  if (report.status === 'no_html') {
    return <EmptyCard>This message has no HTML body.</EmptyCard>
  }
  if (report.status === 'size_limit_exceeded') {
    const mb = (report.limit / 1024 / 1024).toFixed(0)
    return (
      <EmptyCard>
        HTML body is larger than {mb}MB — analysis skipped.
      </EmptyCard>
    )
  }
  if (report.status === 'error') {
    return <EmptyCard>{report.msg}</EmptyCard>
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
        <EmptyCard>
          No issues for the current filters. Tick more clients above to widen
          the check.
        </EmptyCard>
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
          <Panel key={idx} className="mb-3 p-5">
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
          </Panel>
        )
      })}
    </>
  )
}
