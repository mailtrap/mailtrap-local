import { Link } from 'react-router-dom'
import { type MessageSummary } from '../../api/messages'
import { CategoryBadge } from '../ui/CategoryBadge'

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (isNaN(then)) return ''
  const seconds = Math.floor((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function primaryRecipient(m: MessageSummary): string {
  return m.to?.[0]?.address || ''
}

// Each row has `data-read` and `data-active`. Children react via
// `group-data-[…]:` so we don't pass the state through props.
// `!` on active rules: Tailwind v4 sorts variants alphabetically, so
// `data-[active]` would lose to `data-[read]` without the override.
const row = [
  'group grid grid-cols-[1fr_auto] grid-rows-[auto_auto] gap-x-3 gap-y-0.5',
  'px-4 py-3 text-inherit no-underline',
  'bg-surface-raised transition-[background-color] duration-150 hover:bg-surface-hover',
  'data-[read=true]:bg-surface-base data-[read=true]:hover:bg-surface-hover',
  'data-[active=true]:!bg-accent data-[active=true]:hover:!bg-accent',
].join(' ')

const subject = [
  'col-start-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-fg',
  'group-data-[read=true]:font-normal group-data-[read=true]:text-fg-muted',
  'group-data-[active=true]:!font-semibold group-data-[active=true]:!text-fg',
].join(' ')

const activeBoldOverride =
  'group-data-[active=true]:!font-semibold group-data-[active=true]:!text-fg'

function MessageRow({ m, active }: { m: MessageSummary; active: boolean }) {
  return (
    <Link
      to={`/message/${m.id}`}
      className={row}
      data-active={active}
      data-read={m.read}
    >
      <span className={subject}>{m.subject || '(no subject)'}</span>
      <span
        className={`col-start-2 row-start-1 justify-self-end whitespace-nowrap text-right text-[13px] text-fg-muted ${activeBoldOverride}`}
      >
        {relativeTime(m.created)}
      </span>
      <span
        className={`col-start-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-fg-muted ${activeBoldOverride}`}
      >
        to: &lt;{primaryRecipient(m)}&gt;
      </span>
      {m.tags[0] && (
        <CategoryBadge
          size="sm"
          className="col-start-2 row-start-2 self-center justify-self-end"
          label={m.tags[0]}
        />
      )}
    </Link>
  )
}

const emptyState = 'px-4 py-6 text-center text-[13px] leading-[1.6] text-fg-muted'

interface Props {
  messages: MessageSummary[] | null
  searchResults: MessageSummary[] | null
  searching: boolean
  query: string
  activeId: string | undefined
  error: string | null
}

export function MessageList({
  messages,
  searchResults,
  searching,
  query,
  activeId,
  error,
}: Props) {
  if (error) return <div className={emptyState}>Error: {error}</div>

  // An active search owns the list, so resolve its empty-state before the
  // inbox's. Otherwise a search that returns hits while the inbox itself
  // is empty would render "No messages yet" instead of the results.
  if (searchResults !== null) {
    if (searchResults.length === 0 && !searching) {
      return (
        <div className={emptyState}>No matches for "{query.trim()}".</div>
      )
    }
  } else if (messages && messages.length === 0) {
    return (
      <div className={emptyState}>
        <p>No messages yet.</p>
        <p>
          Send to{' '}
          <code className="rounded bg-accent/10 text-accent px-1.5 py-0.5 text-xs">
            127.0.0.1:3535
          </code>
          .
        </p>
      </div>
    )
  }

  const displayed = searchResults ?? messages
  if (!displayed || displayed.length === 0) return null
  return (
    <ul className="list-none p-0 m-0">
      {displayed.map((m) => (
        <li key={m.id} className="border-b border-border-base">
          <MessageRow m={m} active={m.id === activeId} />
        </li>
      ))}
    </ul>
  )
}
