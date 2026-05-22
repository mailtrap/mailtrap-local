import {
  type ClientCategory,
  type HtmlCheckReport,
} from '../../../api/messages'
import { clientPassesFilters } from '../../../lib/htmlCheckStats'
import { EmptyCard } from '../../ui/EmptyCard'
import HtmlCheckSummary from './HtmlCheckSummary'
import IssueCard from './IssueCard'

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

  const { enabledCategories, enabledFamilies } = filters
  const enabledCats = (
    Object.keys(enabledCategories) as ClientCategory[]
  ).filter((c) => enabledCategories[c])

  // An issue with zero remaining clients after filtering is dropped.
  const visibleIssues = report.issues
    .map((issue) => ({
      ...issue,
      clients: issue.clients.filter((c) =>
        clientPassesFilters(c, enabledCats, enabledFamilies),
      ),
    }))
    .filter((issue) => issue.clients.length > 0)

  return (
    <>
      <HtmlCheckSummary report={report} filters={filters} />

      {visibleIssues.length === 0 && (
        <EmptyCard>
          No issues for the current filters. Tick more clients above to widen
          the check.
        </EmptyCard>
      )}

      {visibleIssues.map((issue, idx) => (
        <IssueCard key={idx} issue={issue} />
      ))}
    </>
  )
}
