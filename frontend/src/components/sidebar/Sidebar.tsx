import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import { Link, useMatch, useNavigate } from 'react-router-dom'
import mailtrapLogo from '../../assets/mailtrap-logo.svg'
import {
  deleteAllMessages,
  getMessages,
  markAllRead,
  searchMessages,
  type MessageSummary,
  type MessagesResponse,
} from '../../api/messages'
import { CloudConnectDialog } from '../connections/CloudConnectDialog'
import { ConnectionErrorBanner } from './ConnectionErrorBanner'
import { RelayConnectDialog } from '../connections/RelayConnectDialog'
import { SettingsMenu } from '../connections/SettingsMenu'
import { useCloudConnection } from '../../hooks/useCloudConnection'
import { useRelayConnection } from '../../hooks/useRelayConnection'
import { useWebhookConnection } from '../../hooks/useWebhookConnection'
import { useMessagesChannel } from '../../hooks/useMessagesChannel'
import { Strip } from '../ui/Strip'
import { SidebarToolbar } from './SidebarToolbar'
import { MessageList } from './MessageList'
import { DeleteAllPrompt } from './DeleteAllPrompt'
import { extractApiError, isAbortError } from '../../api/client'

const PAGE_SIZE = 100
// Fetch the next page once the user scrolls within this many pixels of
// the bottom of the list.
const SCROLL_THRESHOLD_PX = 200

// Live "created" frames prepend while paging appends from the tail, so
// a page fetched after a prepend can overlap rows we already hold.
// Dedupe by id instead of trusting offsets alone.
function appendUnique(
  prev: MessageSummary[] | null,
  page: MessageSummary[],
): MessageSummary[] {
  if (!prev) return page
  const seen = new Set(prev.map((m) => m.id))
  return [...prev, ...page.filter((m) => !seen.has(m.id))]
}

export function Sidebar() {
  const navigate = useNavigate()
  // Sidebar lives outside <Routes>, so useMatch instead of useParams.
  const match = useMatch('/message/:id')
  const activeId = match?.params.id

  const [messages, setMessages] = useState<MessageSummary[] | null>(null)
  // Server-reported totals gate "has more pages". Every page response
  // resyncs them, so transient drift from live updates self-heals.
  const [total, setTotal] = useState(0)
  // null = search inactive (show `messages`). [] = search returned zero
  // matches (show "No matches" empty state).
  const [searchResults, setSearchResults] = useState<MessageSummary[] | null>(
    null,
  )
  const [searchTotal, setSearchTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchRevision, setSearchRevision] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  // In-flight page fetch. Doubles as the "one page at a time" guard and
  // the abort handle when a refetch or query change makes it stale.
  const loadMoreRef = useRef<AbortController | null>(null)
  const messageIdsRef = useRef(new Set<string>())
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [cloudOpen, setCloudOpen] = useState(false)
  const [relayOpen, setRelayOpen] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { state: cloudState } = useCloudConnection()
  const { state: relayState } = useRelayConnection()
  const { state: webhookState } = useWebhookConnection()
  const webhookActive =
    webhookState?.connected === true && webhookState?.enabled === true

  const fetchMessages = useCallback((signal?: AbortSignal) => {
    // A refetch replaces the list from page one, so a pending page
    // append would land on stale offsets (or resurrect just-deleted
    // rows after a delete-all). Cancel it first.
    loadMoreRef.current?.abort()
    getMessages({ limit: PAGE_SIZE }, signal)
      .then((r) => {
        messageIdsRef.current = new Set(r.messages.map((m) => m.id))
        setMessages(r.messages)
        setTotal(r.total)
      })
      .catch((e) => {
        if (!isAbortError(e)) setError(String(e))
      })
  }, [])

  // Initial fetch on mount. Live updates flow through useMessagesChannel.
  useEffect(() => {
    const c = new AbortController()
    fetchMessages(c.signal)
    return () => {
      c.abort()
      loadMoreRef.current?.abort()
    }
  }, [fetchMessages])

  const loadPage = (
    fetchPage: (signal: AbortSignal) => Promise<MessagesResponse>,
    apply: (r: MessagesResponse) => void,
  ) => {
    const controller = new AbortController()
    loadMoreRef.current = controller
    setLoadingMore(true)
    fetchPage(controller.signal)
      .then((r) => {
        // The signal is re-checked because our api mocks (and axios in
        // some paths) can resolve after an abort — a stale page must
        // never append into a list that has since been replaced.
        if (!controller.signal.aborted) apply(r)
      })
      .catch((e) => {
        if (!isAbortError(e))
          setActionError(`Load more failed: ${extractApiError(e)}`)
      })
      .finally(() => {
        if (loadMoreRef.current === controller) loadMoreRef.current = null
        setLoadingMore(false)
      })
  }

  const loadMore = () => {
    if (loadMoreRef.current) return
    if (searchResults !== null) {
      if (searching || searchResults.length >= searchTotal) return
      const trimmed = query.trim()
      const start = searchResults.length
      loadPage(
        (signal) =>
          searchMessages({ query: trimmed, start, limit: PAGE_SIZE }, signal),
        (r) => {
          setSearchTotal(r.total)
          setSearchResults((prev) => appendUnique(prev, r.messages))
        },
      )
    } else {
      if (!messages || messages.length >= total) return
      const start = messages.length
      loadPage(
        (signal) => getMessages({ start, limit: PAGE_SIZE }, signal),
        (r) => {
          setTotal(r.total)
          r.messages.forEach((m) => messageIdsRef.current.add(m.id))
          setMessages((prev) => appendUnique(prev, r.messages))
        },
      )
    }
  }

  const onListScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD_PX)
      loadMore()
  }

  const restartActiveSearch = useCallback(() => {
    loadMoreRef.current?.abort()
    setSearchResults([])
    setSearchTotal(0)
    setSearching(true)
    setSearchRevision((revision) => revision + 1)
  }, [])

  const onMessageCreated = useCallback((m: MessageSummary) => {
    if (messageIdsRef.current.has(m.id)) return
    messageIdsRef.current.add(m.id)
    setTotal((t) => t + 1)
    setMessages((prev) => {
      if (!prev) return [m]
      if (prev.some((x) => x.id === m.id)) return prev
      return [m, ...prev]
    })

    if (searchResults !== null) restartActiveSearch()
  }, [restartActiveSearch, searchResults])
  const onMessageDestroyed = useCallback((id: string) => {
    loadMoreRef.current?.abort()

    const wasLoaded = messageIdsRef.current.delete(id)
    if (wasLoaded) setTotal((t) => Math.max(0, t - 1))
    setMessages((prev) => (prev ? prev.filter((m) => m.id !== id) : prev))

    if (searchResults !== null) restartActiveSearch()
  }, [restartActiveSearch, searchResults])
  useMessagesChannel({
    onCreated: onMessageCreated,
    onDestroyed: onMessageDestroyed,
    // After laptop sleep/wake the in-memory list is stale; the server
    // can't replay the gap, so refetch.
    onReconnect: () => fetchMessages(),
  })

  // Server marks a message read on GET /api/v1/message/:id. Mirror that
  // locally so the row updates immediately without a refetch. Done during
  // render via the "adjusting state when a prop changes" pattern.
  const [lastActiveId, setLastActiveId] = useState(activeId)
  if (activeId !== lastActiveId) {
    setLastActiveId(activeId)
    if (activeId) {
      setMessages((prev) =>
        prev
          ? prev.map((m) =>
              m.id === activeId && !m.read ? { ...m, read: true } : m,
            )
          : prev,
      )
    }
  }

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

  // Sync the spinner + clear stale results during render when the query
  // changes. The actual API call still runs in an effect (it's a true side
  // effect with cleanup), but the immediate UI state changes go here.
  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setSearchResults(null)
      setSearchTotal(0)
      setSearching(false)
    } else {
      setSearchResults([])
      setSearchTotal(0)
      setSearching(true)
    }
  }

  // Debounced server-side search. While search is active we do NOT merge
  // channel creates/destroys into searchResults — re-running the server
  // search on every inbound message would cause flicker.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) return
    const controller = new AbortController()
    const handle = setTimeout(() => {
      searchMessages({ query: trimmed, limit: PAGE_SIZE }, controller.signal)
        .then((r) => {
          setSearchResults(r.messages)
          setSearchTotal(r.total)
        })
        .catch((e) => {
          if (!isAbortError(e)) setError(String(e))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 200)
    return () => {
      clearTimeout(handle)
      controller.abort()
      // The query changed (or we unmounted) — a pending "load more" for
      // the old result set must not append into the new one.
      loadMoreRef.current?.abort()
    }
  }, [query, searchRevision])

  return (
    <aside className="flex min-h-0 flex-col border-r border-border-base">
      <ConnectionErrorBanner />
      <SidebarToolbar
        query={query}
        onQueryChange={setQuery}
        cloudState={cloudState}
        relayState={relayState}
        onOpenCloud={() => setCloudOpen(true)}
        onOpenRelay={() => setRelayOpen(true)}
        onMarkAllRead={onMarkAllRead}
        onRefresh={() => fetchMessages()}
        onCleanAll={onCleanAllClick}
      />
      <CloudConnectDialog open={cloudOpen} onOpenChange={setCloudOpen} />
      <RelayConnectDialog open={relayOpen} onOpenChange={setRelayOpen} />

      {confirmDeleteAll && (
        <DeleteAllPrompt
          count={total}
          busy={busy}
          onConfirm={onConfirmCleanAll}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}

      {actionError && (
        <Strip
          variant="error"
          shape="banner"
          role="alert"
          onDismiss={() => setActionError(null)}
        >
          {actionError}
        </Strip>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" onScroll={onListScroll}>
        <MessageList
          messages={messages}
          searchResults={searchResults}
          searching={searching}
          loadingMore={loadingMore}
          query={query}
          activeId={activeId}
          error={error}
        />
      </div>

      <div className="flex items-center justify-between border-t border-border-base bg-surface-base px-3 py-2.5">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-fg no-underline text-[13px] font-semibold tracking-[0.01em] opacity-95 hover:opacity-100"
          title="Back to sandbox"
          aria-label="Back to sandbox"
        >
          <img
            src={mailtrapLogo}
            alt="Mailtrap"
            className="block h-7 w-auto"
          />
        </Link>
        <SettingsMenu webhookActive={webhookActive} />
      </div>
    </aside>
  )
}
