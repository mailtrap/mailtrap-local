import { useEffect, useRef } from 'react'
import { subscribe, subscribeReconnect } from '../lib/cable'
import type { MessageSummary } from '../api/messages'

export interface MessagesChannelHandlers {
  onCreated?: (message: MessageSummary) => void
  onDestroyed?: (id: string) => void
  /**
   * Fires when the underlying WebSocket reopens after a drop. Use to
   * refetch list state — frames the server tried to push during the
   * gap are lost. Never fires on the initial connection.
   */
  onReconnect?: () => void
}

/**
 * Subscribes to the live message channel and dispatches inbound
 * broadcasts to the supplied callbacks.
 *
 * Subscription lifecycle: exactly once per consumer mount. The hook
 * stashes the callbacks in refs and uses an empty dep array on the
 * effect — so callers don't have to memoize their handlers, and a
 * misbehaving render loop can't accidentally accumulate stale
 * subscriptions. (We saw a `(2)` doubling regression in the favicon
 * badge during early-pre-release testing that turned out to be two
 * listener closures registered for one logical consumer; this guards
 * against that class of bug categorically.)
 */
export function useMessagesChannel({
  onCreated,
  onDestroyed,
  onReconnect,
}: MessagesChannelHandlers): void {
  // Refs let the (stable) listener closure read the latest callback
  // identity without re-subscribing.
  const onCreatedRef = useRef(onCreated)
  const onDestroyedRef = useRef(onDestroyed)
  const onReconnectRef = useRef(onReconnect)

  // Sync refs after each render. (react-hooks v7 forbids writing refs
  // in render body.) The microsecond gap between render commit and
  // effect run is harmless here — frame dispatch is async; even if a
  // frame arrives in that window, the next render syncs and the next
  // frame uses the fresh callback.
  useEffect(() => {
    onCreatedRef.current = onCreated
    onDestroyedRef.current = onDestroyed
    onReconnectRef.current = onReconnect
  })

  useEffect(() => {
    const unsubMsg = subscribe((msg) => {
      if (msg.type === 'created') onCreatedRef.current?.(msg.message)
      else if (msg.type === 'destroyed') onDestroyedRef.current?.(msg.id)
    })
    const unsubReconnect = subscribeReconnect(() => {
      onReconnectRef.current?.()
    })
    return () => {
      unsubMsg()
      unsubReconnect()
    }
    // Empty deps: the subscription persists for the lifetime of the
    // consumer. Refs above carry the freshest callback identity into
    // the dispatch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
