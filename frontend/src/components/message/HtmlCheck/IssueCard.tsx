import { useState } from 'react'
import type { HtmlCheckClient, HtmlCheckReport } from '../../../api/messages'
import Panel from '../../ui/Panel'

const title = 'mt-0 mb-2.5 text-base font-semibold text-fg font-mono'

const clientsRow = 'mb-3 grid grid-cols-[64px_1fr] gap-3'
const clientsLabel = 'pt-1 text-[13px] font-semibold text-fg'
const chipsContainer = 'flex flex-wrap items-center gap-x-3.5 gap-y-1.5'

const chip = 'inline-flex items-center gap-1.5 text-[13px] text-fg'

// data-support drives the dot colour; data-noted highlights versions
// that have an attached note number.
const supportDot = [
  'inline-block h-[9px] w-[9px] rounded-full',
  'data-[support=no]:bg-danger',
  'data-[support=partial]:bg-warning',
  'data-[support=yes]:bg-success',
].join(' ')

const versionPill = [
  'inline-flex h-[18px] min-w-[18px] items-center justify-center',
  'rounded bg-surface-hover px-[5px]',
  'font-mono text-[11px] font-semibold text-fg',
  'data-[noted=true]:bg-accent data-[noted=true]:text-fg',
].join(' ')

const lines = 'mb-2 text-[13px] text-fg-icon'
const linesCode = 'font-mono text-accent'

const toggle =
  'mb-2 inline-block cursor-pointer text-xs text-accent hover:underline'

const notes = 'mt-1 text-[13px] leading-[1.55] text-fg'
const notesHeading = 'm-0 mb-1.5 text-[13px] font-semibold'
const notesList = 'm-0 pl-[22px]'
const notesItem = 'mb-1.5'

const reflink = 'mt-3 text-xs'
const reflinkLink = 'text-accent no-underline hover:underline'

/**
 * A single client's affected versions as colored chips: "support dot +
 * version pill". Red for "no", amber for "partial". Note-number badges
 * highlighted in accent blue.
 */
function ClientChips({
  family,
  platform,
  display_name: name,
  support,
  versions,
  note_numbers: noteNumbers,
}: HtmlCheckClient) {
  // "yes" versions aren't worth surfacing — they're already supported.
  const affected = [...(versions?.no ?? []), ...(versions?.partial ?? [])]
  const noteSet = new Set((noteNumbers ?? []).map((n) => String(n)))
  return (
    <span className={chip} key={`${family}-${platform}`}>
      <span className={supportDot} data-support={support} />
      {name}
      {affected.map((v) => (
        <span
          key={v}
          className={versionPill}
          data-noted={noteSet.has(v) || undefined}
        >
          {v}
        </span>
      ))}
    </span>
  )
}

type Issue = Extract<
  HtmlCheckReport,
  { status: 'success' }
>['issues'][number]

const LINE_LIMIT = 6

export default function IssueCard({ issue }: { issue: Issue }) {
  const [showAll, setShowAll] = useState(false)
  const visibleLines =
    showAll || issue.error_lines.length <= LINE_LIMIT
      ? issue.error_lines
      : issue.error_lines.slice(0, LINE_LIMIT)
  const noteEntries = Object.entries(issue.numbered_notes).sort(
    ([a], [b]) => Number(a) - Number(b),
  )

  return (
    <Panel className="mb-3 p-5">
      <h3 className={title}>{issue.rule_name}</h3>

      <div className={clientsRow}>
        <div className={clientsLabel}>Clients:</div>
        <div className={chipsContainer}>
          {issue.clients.map((c) => (
            <ClientChips key={`${c.family}-${c.platform}`} {...c} />
          ))}
        </div>
      </div>

      <div className={lines}>
        Found on lines:{' '}
        {visibleLines.map((l, i) => (
          <span key={l}>
            <code className={linesCode}>{l}</code>
            {i < visibleLines.length - 1 ? ', ' : ''}
          </span>
        ))}
      </div>
      {issue.error_lines.length > LINE_LIMIT && (
        <button
          type="button"
          className={toggle}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? 'Show less'
            : `Show all ${issue.error_lines.length} lines`}
        </button>
      )}

      {noteEntries.length > 0 && (
        <div className={notes}>
          <h4 className={notesHeading}>Notes:</h4>
          <ol className={notesList}>
            {noteEntries.map(([n, text]) => (
              <li key={n} className={notesItem}>
                {text}
              </li>
            ))}
          </ol>
        </div>
      )}

      {issue.url && (
        <div className={reflink}>
          See full reference on{' '}
          <a
            href={issue.url}
            className={reflinkLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            caniemail.com
          </a>
        </div>
      )}
    </Panel>
  )
}
