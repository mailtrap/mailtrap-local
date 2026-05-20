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
  deleteAllMessages,
  getMessages,
  markAllRead,
  searchMessages,
  type MessageSummary,
} from '../api/messages'
import CloudConnectDialog from './CloudConnectDialog'
import { ConnectionErrorBanner } from './ConnectionErrorBanner'
import RelayConnectDialog from './RelayConnectDialog'
import SettingsMenu from './SettingsMenu'
import { useCloudConnection } from '../hooks/useCloudConnection'
import { useRelayConnection } from '../hooks/useRelayConnection'
import { useWebhookConnection } from '../hooks/useWebhookConnection'
import { useMessagesChannel } from '../hooks/useMessagesChannel'
import { IconButton } from './IconButton'
import { extractApiError, isAbortError } from '../api/client'

const sidebar = 'flex min-h-0 flex-col border-r border-border-base'

// Pin the toolbar row at 58px so the list below doesn't jump when the
// search input bumps into position: absolute on focus.
const toolbar = [
  'relative grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-1.5',
  'min-h-[58px] border-b border-border-base p-3',
].join(' ')

const footerCss =
  'flex items-center justify-between border-t border-border-base bg-surface-base px-3 py-2.5'

const footerBrandCss = [
  'inline-flex items-center gap-2 text-fg no-underline',
  'text-[13px] font-semibold tracking-[0.01em] opacity-95 hover:opacity-100',
].join(' ')

const footerBrandImgCss = 'block h-7 w-auto'

// Search input + its expanded "cover the toolbar" mode + the inline
// clear button. The wrapper carries `group` + `data-expanded`; child
// behaviors that depend on expansion use `group-data-[expanded=true]:`.
const searchWrapCss = [
  'group relative',
  // Expanded — absolutely position over the icon row to the right.
  'data-[expanded=true]:absolute data-[expanded=true]:left-3 data-[expanded=true]:right-3',
  'data-[expanded=true]:top-3 data-[expanded=true]:bottom-3 data-[expanded=true]:z-[2]',
].join(' ')

const searchInputCss = [
  'w-full rounded-[7px] border border-border-base bg-surface-base',
  'py-1.5 pl-2.5 pr-8 text-sm text-fg outline-none',
  'placeholder:text-fg-muted focus:border-accent',
  // Wider right padding when the clear (×) button is visible.
  'group-data-[expanded=true]:bg-surface-base group-data-[expanded=true]:pr-9',
].join(' ')

const searchIconCss = [
  'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg',
  'group-data-[expanded=true]:hidden',
].join(' ')

const searchClearCss = [
  'absolute right-1.5 top-1/2 -translate-y-1/2',
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded',
  'text-fg-icon hover:bg-accent-soft hover:text-fg',
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
const promptBarCss = [
  'flex items-center gap-2 border-b border-surface-hover bg-surface-raised',
  'px-3 py-2.5 text-[13px] text-fg',
].join(' ')

const promptBarTextCss =
  'flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'

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
const errorBarCss = [
  'flex items-center gap-2 border-b border-danger-border bg-danger-soft',
  'px-3 py-2 text-xs leading-[1.4] text-danger',
].join(' ')

const errorBarTextCss = 'flex-1 min-w-0'

const errorDismissBtn = [
  'inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center',
  'rounded text-danger',
  'hover:bg-danger-border',
].join(' ')

// Message-row list. Each row (the <Link>) is a 2-col / 2-row grid:
//   col1 row1: subject  · col2 row1: time
//   col1 row2: recipient · col2 row2: category badge
//
// The row carries `group` + `data-read` + `data-active`; nested
// elements use `group-data-[…]:` variants to react to row state.
const listCss = 'list-none p-0 m-0'

const listItemCss = 'border-b border-border-base'

// Active vs read: Tailwind v4 emits `data-[active=true]:` and
// `data-[read=true]:` in a stable variant order (not className source
// order), so the active utilities need `!` to win the tiebreak — same
// situation the original code had to work around.
const listRowCss = [
  'group grid grid-cols-[1fr_auto] grid-rows-[auto_auto] gap-x-3 gap-y-0.5',
  'px-4 py-3 text-inherit no-underline',
  'bg-surface-raised transition-[background-color] duration-150',
  'hover:bg-surface-hover',
  // Read state — blends with page background until hovered.
  'data-[read=true]:bg-surface-base data-[read=true]:hover:bg-surface-hover',
  // Active state — must beat the read state.
  'data-[active=true]:!bg-accent data-[active=true]:hover:!bg-accent',
].join(' ')

const listSubjectCss = [
  'col-start-1 overflow-hidden text-ellipsis whitespace-nowrap',
  'font-semibold text-fg',
  'group-data-[read=true]:font-normal group-data-[read=true]:text-fg-muted',
  'group-data-[active=true]:!font-semibold group-data-[active=true]:!text-fg',
].join(' ')

const listTimeCss = [
  'col-start-2 row-start-1 justify-self-end',
  'whitespace-nowrap text-right text-[13px] text-fg-muted',
  'group-data-[active=true]:!font-semibold group-data-[active=true]:!text-fg',
].join(' ')

const listRecipientCss = [
  'col-start-1 overflow-hidden text-ellipsis whitespace-nowrap',
  'text-[13px] text-fg-muted',
  'group-data-[active=true]:!font-semibold group-data-[active=true]:!text-fg',
].join(' ')

const listCategoryCss = [
  'col-start-2 row-start-2 self-center justify-self-end',
  'inline-block max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap',
  'rounded-full bg-accent-medium px-2 py-0.5',
  'text-[11px] font-semibold leading-[1.4] text-accent',
  'group-data-[active=true]:bg-white/20 group-data-[active=true]:text-fg',
].join(' ')

const emptyStateCss =
  'px-4 py-6 text-center text-[13px] leading-[1.6] text-fg-muted'

const emptyStateCodeCss =
  'rounded bg-accent/10 text-accent px-1.5 py-0.5 text-xs'

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

  const fetchMessages = useCallback((signal?: AbortSignal) => {
    getMessages({ limit: 100 }, signal)
      .then((r) => setMessages(r.messages))
      .catch((e) => {
        if (!isAbortError(e)) setError(String(e))
      })
  }, [])

  // Initial fetch on mount. Subsequent inbound deliveries arrive over
  // the WebSocket channel (see useMessagesChannel below); user actions
  // still call fetchMessages() directly when they need a full refresh.
  useEffect(() => {
    const c = new AbortController()
    fetchMessages(c.signal)
    return () => c.abort()
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
      await deleteAllMessages()
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
    const controller = new AbortController()
    const handle = setTimeout(() => {
      searchMessages({ query: trimmed, limit: 100 }, controller.signal)
        .then((r) => setSearchResults(r.messages))
        .catch((e) => {
          if (!isAbortError(e)) setError(String(e))
        })
        .finally(() => {
          // Don't flip the spinner off if we were cancelled mid-flight —
          // the next keystroke's effect already set it back to true.
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 200)
    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [query])

  // What the list actually renders. Search wins when active; otherwise
  // we show the live `messages` array (kept in sync over the WebSocket).
  const displayedMessages = searchResults ?? messages

  return (
    <aside className={sidebar}>
      <ConnectionErrorBanner />
      <div className={toolbar}>
        <div className={searchWrapCss} data-expanded={searchExpanded}>
          <SearchIcon className={searchIconCss} size={14} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search…"
            className={searchInputCss}
            value={query}
            onFocus={() => setSearchExpanded(true)}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searchExpanded && (
            <button
              className={searchClearCss}
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
        <IconButton
          variant="toolbar"
          title="Refresh"
          onClick={() => fetchMessages()}
        >
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
        <div className={promptBarCss}>
          <span className={promptBarTextCss}>
            Delete all {messages?.length ?? 0} messages?
          </span>
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
        <div className={errorBarCss} role="alert">
          <span className={errorBarTextCss}>{actionError}</span>
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
        {error && <div className={emptyStateCss}>Error: {error}</div>}

        {!error && messages && messages.length === 0 && (
          <div className={emptyStateCss}>
            <p>No messages yet.</p>
            <p>
              Send to <code className={emptyStateCodeCss}>127.0.0.1:3535</code>
              .
            </p>
          </div>
        )}

        {!error &&
          searchResults !== null &&
          searchResults.length === 0 &&
          !searching && (
            <div className={emptyStateCss}>No matches for "{query.trim()}".</div>
          )}

        {displayedMessages && displayedMessages.length > 0 && (
          <ul className={listCss}>
            {displayedMessages.map((m) => (
              <li key={m.id} className={listItemCss}>
                <Link
                  to={`/message/${m.id}`}
                  className={listRowCss}
                  data-active={m.id === activeId}
                  data-read={m.read}
                >
                  <span className={listSubjectCss}>
                    {m.subject || '(no subject)'}
                  </span>
                  <span className={listTimeCss}>{relativeTime(m.created)}</span>
                  <span className={listRecipientCss}>
                    to: &lt;{primaryRecipient(m)}&gt;
                  </span>
                  {m.tags[0] && (
                    <span
                      className={listCategoryCss}
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

      <div className={footerCss}>
        <Link
          to="/"
          className={footerBrandCss}
          title="Back to sandbox"
          aria-label="Back to sandbox"
        >
          <img src={mailtrapLogo} alt="Mailtrap" className={footerBrandImgCss} />
        </Link>
        <SettingsMenu webhookActive={webhookActive} />
      </div>
    </aside>
  )
}
