import {
  type ClientCategory,
  type HtmlCheckReport,
} from '../../../api/messages'
import {
  filteredFamilySupportStats,
  filteredMarketShareInfo,
} from '../../../lib/htmlCheckStats'
import type { HtmlCheckFilterState } from './index'

const top = [
  'mb-4 grid grid-cols-[auto_1fr] items-center gap-7',
  'rounded-none bg-surface-base px-6 pt-5 pb-6',
].join(' ')

const donut = 'relative h-[180px] w-[180px]'
const donutCenter = [
  'pointer-events-none absolute inset-0',
  'flex flex-col items-center justify-center',
].join(' ')
const donutPct = 'text-[30px] font-bold leading-none text-success'
const donutLabel =
  'mt-1.5 text-[10px] font-bold tracking-[0.18em] text-fg uppercase'

const filterStrip = 'mb-3.5 flex items-center gap-[22px] text-[13px] text-fg'
const filterLabel = 'inline-flex cursor-pointer items-center gap-1.5'
const filterCheckbox = '[accent-color:var(--color-accent)]'
const filterCount = 'text-fg-icon'

const familyTable = 'flex max-w-[520px] flex-col text-[13px]'
const familyRow = [
  'group grid grid-cols-[160px_56px_56px_56px_64px] items-center',
  'gap-x-3.5 rounded-md px-1 py-2',
  'hover:bg-surface-base',
].join(' ')
const familyName = 'inline-flex items-center gap-2.5 text-fg'
const familyCheckbox = 'h-3.5 w-3.5 [accent-color:var(--color-accent)]'
const pctBase = 'text-right font-bold'
const pctSupported = `${pctBase} text-success`
const pctPartial = `${pctBase} invisible text-warning group-hover:visible`
const pctNo = `${pctBase} invisible text-danger group-hover:visible`
const familyOnly = [
  'invisible cursor-pointer rounded-full border border-accent',
  'px-3.5 py-1 text-center text-xs font-semibold text-accent',
  'hover:bg-accent-soft group-hover:visible',
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
  const segs: Array<[number, string]> = [
    [supported, 'var(--color-success)'],
    [partial, 'var(--color-warning)'],
    [no, 'var(--color-danger)'],
  ]
  let elapsedPct = 0
  return (
    <div className={donut}>
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
          // Start at 12 o'clock + however far previous segments have advanced.
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
      <div className={donutCenter}>
        <span className={donutPct}>{supported.toFixed(1)}%</span>
        <span className={donutLabel}>Market support</span>
      </div>
    </div>
  )
}

interface Props {
  report: Extract<HtmlCheckReport, { status: 'success' }>
  filters: HtmlCheckFilterState
}

export default function HtmlCheckSummary({ report, filters }: Props) {
  const {
    enabledCategories,
    setEnabledCategories,
    enabledFamilies,
    setEnabledFamilies,
  } = filters

  const enabledCats = (
    Object.keys(enabledCategories) as ClientCategory[]
  ).filter((c) => enabledCategories[c])

  const totalsByCategory = report.families.reduce(
    (acc, f) => {
      acc.desktop += f.version_counts.desktop
      acc.mobile += f.version_counts.mobile
      acc.web += f.version_counts.web
      return acc
    },
    { desktop: 0, mobile: 0, web: 0 },
  )

  // Per-family support stats: counts UNIQUE affected versions per
  // (family, enabled categories). A version flagged both "no" and "partial"
  // only counts as "no".
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
    <div className={top}>
      <MarketSupportDonut
        supported={market.supported}
        partial={market.partial}
        no={market.no}
      />
      <div>
        <div className={filterStrip}>
          {(['desktop', 'mobile', 'web'] as const).map((cat) => (
            <label key={cat} className={filterLabel}>
              <input
                type="checkbox"
                className={filterCheckbox}
                checked={enabledCategories[cat]}
                onChange={(e) =>
                  setEnabledCategories({
                    ...enabledCategories,
                    [cat]: e.target.checked,
                  })
                }
              />
              <span className="capitalize">{cat}</span>{' '}
              <span className={filterCount}>({totalsByCategory[cat]})</span>
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
            // Only/All toggle: "All" appears iff this row is the sole
            // enabled family — clicking it undoes the "Only" pick.
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
              <div key={f.family} className={familyRow}>
                <label className={familyName}>
                  <input
                    type="checkbox"
                    className={familyCheckbox}
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
                <span className={pctSupported}>{stats.supported}%</span>
                <span className={pctPartial}>{stats.partial}%</span>
                <span className={pctNo}>{stats.no}%</span>
                <button
                  type="button"
                  className={familyOnly}
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
  )
}
