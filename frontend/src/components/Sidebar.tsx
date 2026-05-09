import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useMatch, useNavigate } from 'react-router-dom'
import {
  SearchIcon,
  MarkReadIcon,
  ReloadIcon,
  ClearSandboxIcon,
  CloudIcon,
  CloseIcon,
  RelayIcon,
} from './icons'
import mailtrapLogo from '../assets/mailtrap-logo.svg'
import {
  deleteMessages,
  getMessages,
  markAllRead,
  searchMessages,
  type MessageSummary,
} from '../api/messages'
import CloudConnectDialog from './CloudConnectDialog'
import RelayConnectDialog from './RelayConnectDialog'
import SettingsMenu from './SettingsMenu'
import { useCloudConnection } from '../hooks/useCloudConnection'
import { useRelayConnection } from '../hooks/useRelayConnection'
import { useWebhookConnection } from '../hooks/useWebhookConnection'
import { useMessagesChannel } from '../hooks/useMessagesChannel'
import { IconButton } from './IconButton'
import { extractApiError } from '../api/client'

const sidebar = 'flex min-h-0 flex-col border-r border-border-base'

// Pin the toolbar row at 58px so the list below doesn't jump when the
// search input bumps into position: absolute on focus.
const toolbar = [
  'relative grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-1.5',
  'min-h-[58px] border-b border-border-base p-3',
].join(' ')

const footer = [
  'flex items-center justify-between border-t border-border-base bg-surface-base px-3 py-2.5',
  '[&_.brand]:inline-flex [&_.brand]:items-center [&_.brand]:gap-2 [&_.brand]:text-fg [&_.brand]:no-underline [&_.brand]:text-[13px] [&_.brand]:font-semibold [&_.brand]:tracking-[0.01em] [&_.brand]:opacity-95',
  '[&_.brand:hover]:opacity-100',
  '[&_.brand_img]:block [&_.brand_img]:h-7 [&_.brand_img]:w-auto',
].join(' ')

// Search input + its expanded "cover the toolbar" mode + the inline
// clear button. data-expanded=true positions the wrapper absolutely
// over the rest of the toolbar.
const searchWrap = [
  'relative',
  // Idle layout
  '[&_input]:w-full [&_input]:rounded-[7px] [&_input]:border [&_input]:border-border-base',
  '[&_input]:bg-surface-base [&_input]:py-1.5 [&_input]:pl-2.5 [&_input]:pr-8',
  '[&_input]:text-sm [&_input]:text-fg [&_input]:outline-none',
  '[&_input::placeholder]:text-fg-muted',
  '[&_input:focus]:border-accent',
  // Magnifier (left/center icon decoration)
  '[&_.icon]:pointer-events-none [&_.icon]:absolute [&_.icon]:right-2.5 [&_.icon]:top-1/2 [&_.icon]:-translate-y-1/2 [&_.icon]:text-fg',
  // Expanded — cover the icon row to the right.
  'data-[expanded=true]:absolute data-[expanded=true]:left-3 data-[expanded=true]:right-3 data-[expanded=true]:top-3 data-[expanded=true]:bottom-3 data-[expanded=true]:z-[2]',
  '[&[data-expanded=true]_.icon]:hidden',
  '[&[data-expanded=true]_input]:pr-9 [&[data-expanded=true]_input]:bg-surface-base',
  // Clear (×) button
  '[&_.clear]:absolute [&_.clear]:right-1.5 [&_.clear]:top-1/2 [&_.clear]:-translate-y-1/2',
  '[&_.clear]:inline-flex [&_.clear]:items-center [&_.clear]:justify-center',
  '[&_.clear]:h-6 [&_.clear]:w-6 [&_.clear]:rounded',
  '[&_.clear]:cursor-pointer [&_.clear]:text-fg-icon',
  '[&_.clear:hover]:bg-accent-soft [&_.clear:hover]:text-fg',
].join(' ')

// Status badge rendered inside the cloud / relay IconButtons. data-on
// drives the colour (green if connected, muted if not).
const statusBadge = [
  'pointer-events-none absolute right-px bottom-px',
  'inline-flex h-2.5 w-2.5 items-center justify-center rounded-full',
  'border-2 border-surface-base text-[9px] font-bold leading-none text-fg',
  'data-[on=true]:bg-success data-[on=false]:bg-fg-muted',
].join(' ')

const scroll = 'min-h-0 flex-1 overflow-y-auto'

// Inline confirmation strip — replaces the native confirm() for
// destructive sidebar actions (currently "delete all").
const promptBar = [
  'flex items-center gap-2 border-b border-surface-hover bg-surface-raised',
  'px-3 py-2.5 text-[13px] text-fg',
  '[&_span]:flex-1 [&_span]:min-w-0 [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap',
].join(' ')

const promptBtnBase = [
  'cursor-pointer rounded-md border border-transparent px-3 py-1 text-xs font-semibold',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

const promptBtnDanger = [
  promptBtnBase,
  'border-danger text-danger',
  'hover:bg-danger-soft',
].join(' ')

const promptBtnOutline = [
  promptBtnBase,
  'border-accent text-accent',
  'hover:bg-accent-soft',
].join(' ')

// Dismissable error strip for failed sidebar actions.
const errorBar = [
  'flex items-center gap-2 border-b border-danger-border bg-danger-soft',
  'px-3 py-2 text-xs leading-[1.4] text-danger',
  '[&_span]:flex-1 [&_span]:min-w-0',
].join(' ')

const errorDismissBtn = [
  'inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center',
  'rounded text-danger',
  'hover:bg-danger-border',
].join(' ')

// Message-row list. Each row is a 2-col / 2-row grid:
//   col1 row1: subject  · col2 row1: time
//   col1 row2: recipient · col2 row2: category badge
const list = [
  'list-none p-0 m-0',
  '[&_li]:border-b [&_li]:border-border-base',
  '[&_a]:grid [&_a]:grid-cols-[1fr_auto] [&_a]:grid-rows-[auto_auto] [&_a]:gap-x-3 [&_a]:gap-y-0.5',
  '[&_a]:px-4 [&_a]:py-3 [&_a]:text-inherit [&_a]:no-underline',
  '[&_a]:bg-surface-raised [&_a]:transition-[background-color] [&_a]:duration-150',
  '[&_a:hover]:bg-surface-hover',
  // Read state — blends with page background until hovered.
  '[&_a[data-read=true]]:bg-surface-base',
  '[&_a[data-read=true]:hover]:bg-surface-hover',
  // Subject
  '[&_.subject]:col-start-1 [&_.subject]:overflow-hidden [&_.subject]:text-ellipsis [&_.subject]:whitespace-nowrap',
  '[&_.subject]:font-semibold [&_.subject]:text-fg',
  '[&_a[data-read=true]_.subject]:font-normal [&_a[data-read=true]_.subject]:text-fg-muted',
  // Time
  '[&_.time]:col-start-2 [&_.time]:row-start-1 [&_.time]:justify-self-end',
  '[&_.time]:whitespace-nowrap [&_.time]:text-right [&_.time]:text-[13px] [&_.time]:text-fg-muted',
  // Recipient
  '[&_.recipient]:col-start-1 [&_.recipient]:overflow-hidden [&_.recipient]:text-ellipsis [&_.recipient]:whitespace-nowrap',
  '[&_.recipient]:text-[13px] [&_.recipient]:text-fg-muted',
  // Category pill
  '[&_.category]:col-start-2 [&_.category]:row-start-2 [&_.category]:self-center [&_.category]:justify-self-end',
  '[&_.category]:inline-block [&_.category]:max-w-[140px] [&_.category]:overflow-hidden [&_.category]:text-ellipsis [&_.category]:whitespace-nowrap',
  '[&_.category]:rounded-full [&_.category]:bg-accent-medium [&_.category]:px-2 [&_.category]:py-0.5',
  '[&_.category]:text-[11px] [&_.category]:font-semibold [&_.category]:leading-[1.4] [&_.category]:text-accent',
  '[&_a[data-active=true]_.category]:bg-white/20 [&_a[data-active=true]_.category]:text-fg',
  // Active row — must win over read-state colours. The read-state and
  // active-state arbitrary variants have identical specificity, and
  // Tailwind v4 emits them in attribute-name alphabetical order, so
  // [data-active] gets emitted BEFORE [data-read] and would otherwise
  // lose the source-order tiebreak. The `!` modifier promotes these
  // utilities to !important to settle the conflict.
  '[&_a[data-active=true]]:!bg-accent',
  '[&_a[data-active=true]:hover]:!bg-accent',
  '[&_a[data-active=true]_.subject]:!font-semibold [&_a[data-active=true]_.subject]:!text-fg',
  '[&_a[data-active=true]_.recipient]:!font-semibold [&_a[data-active=true]_.recipient]:!text-fg',
  '[&_a[data-active=true]_.time]:!font-semibold [&_a[data-active=true]_.time]:!text-fg',
].join(' ')

const emptyState = [
  'px-4 py-6 text-center text-[13px] leading-[1.6] text-fg-muted',
  '[&_code]:rounded [&_code]:bg-accent/10 [&_code]:text-accent [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs',
].join(' ')

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

export default function Sidebar() {
  const navigate = useNavigate()
  // useParams() only reflects route params when inside the Route element.
  // Sidebar lives outside <Routes>, so use useMatch to read the id.
  const match = useMatch('/message/:id')
  const activeId = match?.params.id
  const [messages, setMessages] = useState<MessageSummary[] | null>(null)
  // Server-side search results, populated from `/api/v1/search` whenever
  // the search input has text. null = search inactive (show `messages`).
  // `[]` = search returned zero matches (show "No matches" empty state).
  // Category filtering is done by typing the category name into the search
  // input — the search service indexes the `category` column alongside
  // subject/from/recipients/snippet/text_body.
  const [searchResults, setSearchResults] = useState<MessageSummary[] | null>(
    null,
  )
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [cloudOpen, setCloudOpen] = useState(false)
  const [relayOpen, setRelayOpen] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { state: cloudState } = useCloudConnection()
  const { state: relayState } = useRelayConnection()
  const { state: webhookState } = useWebhookConnection()
  const isConnected = cloudState?.connected === true
  const isRelayConfigured = relayState?.connected === true
  const webhookActive =
    webhookState?.connected === true && webhookState?.enabled === true

  const fetchMessages = useCallback(() => {
    getMessages({ limit: 100 })
      .then((r) => setMessages(r.messages))
      .catch((e) => setError(String(e)))
  }, [])

  // Initial fetch on mount. Subsequent inbound deliveries arrive over
  // the WebSocket channel (see useMessagesChannel below); user actions
  // still call fetchMessages() directly when they need a full refresh.
  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  // Live updates: prepend incoming messages to the top of the list and
  // drop deleted ones, so the sidebar stays in sync without a refresh.
  // The Set guard de-duplicates against an in-flight refetch (the new
  // row could arrive both via the channel and via the refresh response).
  const onMessageCreated = useCallback((m: MessageSummary) => {
    setMessages((prev) => {
      if (!prev) return [m]
      if (prev.some((x) => x.id === m.id)) return prev
      return [m, ...prev]
    })
  }, [])
  const onMessageDestroyed = useCallback((id: string) => {
    setMessages((prev) => (prev ? prev.filter((m) => m.id !== id) : prev))
  }, [])
  useMessagesChannel({
    onCreated: onMessageCreated,
    onDestroyed: onMessageDestroyed,
  })

  // When the user opens a message, the server marks it as read via
  // GET /api/v1/message/:id. Reflect that locally so the sidebar row
  // updates immediately without having to refetch the whole list.
  useEffect(() => {
    if (!activeId) return
    setMessages((prev) =>
      prev
        ? prev.map((m) =>
            m.id === activeId && !m.read ? { ...m, read: true } : m,
          )
        : prev,
    )
  }, [activeId])

  const onCleanAllClick = () => {
    if (!messages || messages.length === 0) return
    setActionError(null)
    setConfirmDeleteAll(true)
  }

  const onConfirmCleanAll = async () => {
    setBusy(true)
    setActionError(null)
    try {
      await deleteMessages()
      fetchMessages()
      navigate('/', { replace: true })
      setConfirmDeleteAll(false)
    } catch (e) {
      setActionError(`Delete all failed: ${extractApiError(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onMarkAllRead = async () => {
    if (!messages || messages.length === 0) return
    setActionError(null)
    try {
      await markAllRead()
      fetchMessages()
    } catch (e) {
      setActionError(`Mark-all-read failed: ${extractApiError(e)}`)
    }
  }

  // Debounced server-side search: hits `/api/v1/search` after the user
  // pauses typing for a beat, drops results into `searchResults`. When
  // the input is empty, `searchResults` is set back to `null` and the
  // sidebar renders `messages` (the live, channel-updated list).
  //
  // Note on liveness: while a search is active we do NOT auto-merge
  // channel creates/destroys into `searchResults` — re-running the
  // server search on every inbound message would cause flicker. The
  // user clears the search (or hits Refresh) to see fresh results.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const handle = setTimeout(() => {
      searchMessages({ query: trimmed, limit: 100 })
        .then((r) => setSearchResults(r.messages))
        .catch((e) => setError(String(e)))
        .finally(() => setSearching(false))
    }, 200)
    return () => {
      clearTimeout(handle)
    }
  }, [query])

  // What the list actually renders. Search wins when active; otherwise
  // we show the live `messages` array (kept in sync over the WebSocket).
  const displayedMessages = searchResults ?? messages

  return (
    <aside className={sidebar}>
      <div className={toolbar}>
        <div className={searchWrap} data-expanded={searchExpanded}>
          <SearchIcon className="icon" size={14} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search…"
            value={query}
            onFocus={() => setSearchExpanded(true)}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searchExpanded && (
            <button
              className="clear"
              type="button"
              title="Close search"
              onClick={() => {
                setQuery('')
                setSearchExpanded(false)
                searchInputRef.current?.blur()
              }}
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>
        <IconButton
          variant="toolbar"
          title={
            isConnected
              ? `Connected to sandbox ${cloudState?.sandbox_id}${
                  cloudState?.mirror_enabled ? ' · mirroring' : ''
                }`
              : 'Connect to Mailtrap cloud sandbox'
          }
          onClick={() => setCloudOpen(true)}
        >
          <CloudIcon size={16} />
          <span className={statusBadge} data-on={isConnected}>
            {isConnected ? '' : '×'}
          </span>
        </IconButton>
        <IconButton
          variant="toolbar"
          title={
            isRelayConfigured
              ? `SMTP relay → ${relayState?.host}:${relayState?.port}${
                  relayState?.auto_relay_enabled ? ' · auto-relay' : ''
                }`
              : 'Configure SMTP relay'
          }
          onClick={() => setRelayOpen(true)}
        >
          <RelayIcon size={16} />
          <span className={statusBadge} data-on={isRelayConfigured}>
            {isRelayConfigured ? '' : '×'}
          </span>
        </IconButton>
        <IconButton
          variant="toolbar"
          title="Mark all as read"
          onClick={onMarkAllRead}
        >
          <MarkReadIcon size={16} />
        </IconButton>
        <IconButton variant="toolbar" title="Refresh" onClick={fetchMessages}>
          <ReloadIcon size={16} />
        </IconButton>
        <IconButton
          variant="toolbar"
          title="Delete all messages"
          onClick={onCleanAllClick}
        >
          <ClearSandboxIcon size={16} />
        </IconButton>
      </div>
      <CloudConnectDialog open={cloudOpen} onOpenChange={setCloudOpen} />
      <RelayConnectDialog open={relayOpen} onOpenChange={setRelayOpen} />

      {confirmDeleteAll && (
        <div className={promptBar}>
          <span>Delete all {messages?.length ?? 0} messages?</span>
          <button
            type="button"
            className={promptBtnDanger}
            onClick={onConfirmCleanAll}
            disabled={busy}
          >
            Confirm
          </button>
          <button
            type="button"
            className={promptBtnOutline}
            onClick={() => setConfirmDeleteAll(false)}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      )}

      {actionError && (
        <div className={errorBar} role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className={errorDismissBtn}
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
          >
            <CloseIcon size={10} />
          </button>
        </div>
      )}

      <div className={scroll}>
        {error && <div className={emptyState}>Error: {error}</div>}

        {!error && messages && messages.length === 0 && (
          <div className={emptyState}>
            <p>No messages yet.</p>
            <p>
              Send to <code>127.0.0.1:3535</code>.
            </p>
          </div>
        )}

        {!error &&
          searchResults !== null &&
          searchResults.length === 0 &&
          !searching && (
            <div className={emptyState}>No matches for "{query.trim()}".</div>
          )}

        {displayedMessages && displayedMessages.length > 0 && (
          <ul className={list}>
            {displayedMessages.map((m) => (
              <li key={m.id}>
                <Link
                  to={`/message/${m.id}`}
                  data-active={m.id === activeId}
                  data-read={m.read}
                >
                  <span className="subject">
                    {m.subject || '(no subject)'}
                  </span>
                  <span className="time">{relativeTime(m.created)}</span>
                  <span className="recipient">
                    to: &lt;{primaryRecipient(m)}&gt;
                  </span>
                  {m.tags[0] && (
                    <span
                      className="category"
                      title={`Category: ${m.tags[0]}`}
                    >
                      {m.tags[0]}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={footer}>
        <Link
          to="/"
          className="brand"
          title="Back to sandbox"
          aria-label="Back to sandbox"
        >
          <img src={mailtrapLogo} alt="Mailtrap" />
        </Link>
        <SettingsMenu webhookActive={webhookActive} />
      </div>
    </aside>
  )
}
