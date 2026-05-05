import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useMatch, useNavigate } from 'react-router-dom'
import { css } from '@linaria/core'
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
import {
  accent,
  accentBgSoft,
  bg,
  danger,
  dangerBgSoft,
  dangerBorderSoft,
  hover,
  raised,
  success,
  text,
  textMuted,
} from '../styles/tokens'
import { extractApiError } from '../api/client'

const sidebar = css`
  display: flex;
  flex-direction: column;
  border-right: 1px solid #212d3c;
  min-height: 0; /* so the list can scroll */
`

const toolbar = css`
  position: relative;
  display: grid;
  grid-template-columns: 1fr auto auto auto auto auto;
  gap: 6px;
  padding: 12px;
  border-bottom: 1px solid #212d3c;
  align-items: center;
  /* Pin row height so the list below doesn't jump when the search input
     leaves the grid (position: absolute) on focus and the row shrinks to
     the IconButton height. 34px = input height (font 14 + padding 6+6 + borders). */
  min-height: 58px;
`

const footer = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-top: 1px solid #212d3c;
  background: #131e2b;

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #fbfcfc;
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
    opacity: 0.95;
    &:hover {
      opacity: 1;
    }
  }
  .brand img {
    height: 28px;
    width: auto;
    display: block;
  }
`

const searchWrap = css`
  position: relative;

  .icon {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: #fbfcfc;
    pointer-events: none;
  }
  input {
    width: 100%;
    background: #131e2b;
    border: 1px solid #212d3c;
    border-radius: 7px;
    color: #fbfcfc;
    font: inherit;
    font-size: 14px;
    padding: 6px 30px 6px 10px;
    outline: none;
    &:focus {
      border-color: #4c83ee;
    }
    &::placeholder {
      color: #687a91;
    }
  }

  /* When expanded, cover the toolbar icons to the right. The clear × takes
     the icon's slot, so hide the magnifier to avoid overlap. */
  &[data-expanded='true'] {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 12px;
    bottom: 12px;
    z-index: 2;
  }
  &[data-expanded='true'] .icon {
    display: none;
  }
  &[data-expanded='true'] input {
    padding-right: 36px;
    background: #131e2b;
  }

  .clear {
    all: unset;
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    color: #8b9aae;
    cursor: pointer;
  }
  .clear:hover {
    color: #fbfcfc;
    background: rgba(76, 131, 238, 0.08);
  }
`


/* Status badge rendered inside the cloud IconButton. */
const statusBadge = css`
  position: absolute;
  right: 1px;
  bottom: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid ${bg};
  pointer-events: none;
  font-size: 9px;
  line-height: 1;
  color: ${text};
  font-weight: 700;

  &[data-on='true'] {
    background: ${success};
  }
  &[data-on='false'] {
    background: ${textMuted};
  }
`

const scroll = css`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
`

/* Inline confirmation strip — replaces the native confirm() for destructive
   sidebar actions (currently "delete all"). Sits between the toolbar and
   the message list. */
const promptBar = css`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid ${hover};
  background: ${raised};
  font-size: 13px;
  color: ${text};

  span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const promptBtnBase = `
  all: unset;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  &[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const promptBtnDanger = css`
  ${promptBtnBase}
  color: ${danger};
  border-color: ${danger};
  &:hover {
    background: ${dangerBgSoft};
  }
`

const promptBtnOutline = css`
  ${promptBtnBase}
  color: ${accent};
  border-color: ${accent};
  &:hover {
    background: ${accentBgSoft};
  }
`

/* Dismissable error strip for failed sidebar actions. */
const errorBar = css`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid ${dangerBorderSoft};
  background: ${dangerBgSoft};
  font-size: 12px;
  color: ${danger};
  line-height: 1.4;

  span {
    flex: 1;
    min-width: 0;
  }
`

const errorDismissBtn = css`
  all: unset;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: ${danger};
  cursor: pointer;
  &:hover {
    background: ${dangerBorderSoft};
  }
`

const list = css`
  list-style: none;
  padding: 0;
  margin: 0;

  li {
    border-bottom: 1px solid #212d3c;
  }

  a {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    gap: 2px 12px;
    padding: 12px 16px;
    color: inherit;
    text-decoration: none;
    background: #172230; /* unread: raised */
    transition: background-color 0.15s linear;
    &:hover {
      background: #212d3c;
    }
  }

  a[data-read='true'] {
    background: #131e2b; /* read: blends with page */
  }
  a[data-read='true']:hover {
    background: #212d3c;
  }

  .subject {
    font-weight: 600;
    color: #fbfcfc;
    grid-column: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  a[data-read='true'] .subject {
    font-weight: 400;
    color: #687a91;
  }

  .time {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
    text-align: right;
    color: #687a91;
    font-size: 13px;
    white-space: nowrap;
  }

  .recipient {
    grid-column: 1;
    color: #687a91;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .category {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
    align-self: center;
    display: inline-block;
    max-width: 140px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(76, 131, 238, 0.12);
    color: #4c83ee;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a[data-active='true'] .category {
    background: rgba(255, 255, 255, 0.18);
    color: #fbfcfc;
  }

  /* Active state last so it wins over read-state colors. */
  a[data-active='true'],
  a[data-active='true']:hover {
    background: #4c83ee;
  }
  a[data-active='true'] .subject,
  a[data-active='true'] .recipient,
  a[data-active='true'] .time {
    color: #fbfcfc;
    font-weight: 600;
  }
`

const emptyState = css`
  padding: 24px 16px;
  color: #687a91;
  font-size: 13px;
  text-align: center;
  line-height: 1.6;
  code {
    background: rgba(76, 131, 238, 0.1);
    color: #4c83ee;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }
`

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
  const [searchResults, setSearchResults] = useState<MessageSummary[] | null>(null)
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
        ? prev.map((m) => (m.id === activeId && !m.read ? { ...m, read: true } : m))
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
                    <span className="category" title={`Category: ${m.tags[0]}`}>
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
