/**
 * HTML Check support statistics — math for the donut + per-family rows.
 *
 * Two helpers:
 *   - filteredFamilySupportStats()
 *   - filteredMarketShareInfo()
 *
 * 1. For each family + enabled categories, walk every reported issue and
 *    collect that family's affected clients. For each affected client,
 *    qualify each affected version with its display_name (so platforms stay
 *    distinct) and dedupe across rules — so a single Outlook 2007 affected
 *    by 5 rules counts as ONE affected version, not 5.
 * 2. A version that appears in both `no` and `partial` only counts as `no`.
 * 3. `no% = uniqAffected_no_versions * 100 / totalVersions_in_enabled_cats`
 *    `partial% = uniqAffected_partial_versions * 100 / totalVersions`
 *    `supported% = 100 - no% - partial%`
 * 4. Market support % = share-weighted average of supported% across enabled
 *    families, with weights renormalized to sum of enabled shares (so
 *    unticking a family removes its weight from both numerator and denom).
 */

import type {
  ClientCategory,
  HtmlCheckClient,
  HtmlCheckFamily,
  HtmlCheckIssue,
} from '../api/messages'

export interface SupportStats {
  no: number
  partial: number
  supported: number
}

const EMPTY: SupportStats = { no: 0, partial: 0, supported: 100 }

const round = (n: number, digits = 0) => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** Format the {no, partial} pair into a complete {no, partial, supported}. */
function format(stats: { no: number; partial: number }, digits = 0): SupportStats {
  const no = round(stats.no, digits)
  const partial = round(stats.partial, digits)
  const supported = Math.max(round(100 - no - partial, digits), 0)
  return { no, partial, supported }
}

const qualify = (displayName: string, versions: string[] = []): string[] =>
  versions.map((v) => `${displayName} - ${v}`)

/**
 * Per-family support stats for the given filter state.
 */
export function filteredFamilySupportStats(
  issues: HtmlCheckIssue[],
  families: HtmlCheckFamily[],
  enabledCategories: ClientCategory[],
): Record<string, SupportStats> {
  const result: Record<string, SupportStats> = {}

  for (const family of families) {
    const totalVersions = enabledCategories.reduce(
      (sum, cat) => sum + (family.version_counts[cat] ?? 0),
      0,
    )

    if (totalVersions === 0) {
      result[family.family] = { ...EMPTY }
      continue
    }

    const noVersions = new Set<string>()
    const partialVersions = new Set<string>()

    for (const issue of issues) {
      for (const client of issue.clients) {
        if (client.family_group !== family.family) continue
        if (!enabledCategories.includes(client.category)) continue

        for (const v of qualify(client.display_name, client.versions?.no)) {
          noVersions.add(v)
        }
        for (const v of qualify(client.display_name, client.versions?.partial)) {
          partialVersions.add(v)
        }
      }
    }

    // A version flagged as both "no" and "partial" only counts as "no".
    let partialCount = 0
    partialVersions.forEach((v) => {
      if (!noVersions.has(v)) partialCount += 1
    })

    result[family.family] = format({
      no: (noVersions.size * 100) / totalVersions,
      partial: (partialCount * 100) / totalVersions,
    })
  }

  return result
}

/**
 * Share-weighted overall {no, partial, supported}.
 */
export function filteredMarketShareInfo(
  familyStats: Record<string, SupportStats>,
  families: HtmlCheckFamily[],
  enabledFamilies: Record<string, boolean>,
): SupportStats {
  const enabled = families.filter((f) => enabledFamilies[f.family] !== false)
  if (enabled.length === 0) return { ...EMPTY }

  const totalShare = enabled.reduce((s, f) => s + f.market_share, 0)
  if (totalShare <= 0) return { ...EMPTY }

  let no = 0
  let partial = 0
  for (const f of enabled) {
    const stats = familyStats[f.family]
    if (!stats) continue
    const weight = f.market_share / totalShare
    no += stats.no * weight
    partial += stats.partial * weight
  }
  return format({ no, partial }, 1)
}

/** Predicate used elsewhere when filtering issues to render. */
export function clientPassesFilters(
  client: HtmlCheckClient,
  enabledCategories: ClientCategory[],
  enabledFamilies: Record<string, boolean>,
): boolean {
  if (client.support === 'yes') return false
  if (!enabledCategories.includes(client.category)) return false
  if (enabledFamilies[client.family_group] === false) return false
  return true
}

/**
 * Issues containing at least one client with `support === 'no'` after
 * filtering — drives Mailtrap's tab counter ("hard failures only").
 */
export function noSupportIssueCount(
  issues: HtmlCheckIssue[],
  enabledCategories: ClientCategory[],
  enabledFamilies: Record<string, boolean>,
): number {
  return issues.reduce((count, issue) => {
    const hasNo = issue.clients.some(
      (c) =>
        c.support === 'no' &&
        enabledCategories.includes(c.category) &&
        enabledFamilies[c.family_group] !== false,
    )
    return hasNo ? count + 1 : count
  }, 0)
}
