import { useCallback, useEffect, useState } from 'react'
import { Link, useMatch, useNavigate } from 'react-router-dom'
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
import { Strip } from './Strip'
import SidebarToolbar from './SidebarToolbar'
import MessageList from './MessageList'
import DeleteAllPrompt from './DeleteAllPrompt'
import { extractApiError, isAbortError } from '../api/client'

export default function Sidebar() {
  const navigate = useNavigate()
  // Sidebar lives outside <Routes>, so useMatch instead of useParams.
  const match = useMatch('/message/:id')
  const activeId = match?.params.id

  const [messages, setMessages] = useState<MessageSummary[] | null>(null)
  // null = search inactive (show `messages`). [] = search returned zero
  // matches (show "No matches" empty state).
  const [searchResults, setSearchResults] = useState<MessageSummary[] | null>(
    null,
  )
  const [searching, setSearching] = useState(false)
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
    getMessages({ limit: 100 }, signal)
      .then((r) => setMessages(r.messages))
      .catch((e) => {
        if (!isAbortError(e)) setError(String(e))
      })
  }, [])

  // Initial fetch on mount. Live updates flow through useMessagesChannel.
  useEffect(() => {
    const c = new AbortController()
    fetchMessages(c.signal)
    return () => c.abort()
  }, [fetchMessages])

  // Live updates: prepend incoming messages, drop deleted ones. The Set
  // guard de-duplicates against an in-flight refetch returning the same row.
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
    // After laptop sleep/wake the in-memory list is stale; the server
    // can't replay the gap, so refetch.
    onReconnect: () => fetchMessages(),
  })

  // Server marks a message read on GET /api/v1/message/:id. Mirror that
  // locally so the row updates immediately without a refetch.
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

  // Debounced server-side search. While search is active we do NOT merge
  // channel creates/destroys into searchResults — re-running the server
  // search on every inbound message would cause flicker.
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
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 200)
    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [query])

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
          count={messages?.length ?? 0}
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList
          messages={messages}
          searchResults={searchResults}
          searching={searching}
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
