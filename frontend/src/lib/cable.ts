// Tiny pub-sub WebSocket client for the live message channel.
//
// Wire format (matches the Go live.Hub broadcast frames):
//
//   { "type": "created",   "message": { ...MessageSummary } }
//   { "type": "destroyed", "id":      "<message-id>" }
//
// One shared connection per page. Auto-reconnects with bounded
// exponential backoff. Subscribers register a callback; the lib hands
// them every parsed inbound frame and they pattern-match on `type`.

import type { MessageSummary } from '../api/messages'

export type CableMessage =
  | { type: 'created'; message: MessageSummary }
  | { type: 'destroyed'; id: string }

type Listener = (msg: CableMessage) => void

let socket: WebSocket | undefined
let listeners = new Set<Listener>()
let reconnectDelay = 500 // ms; doubles up to 8s
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

function ensureSocket(): void {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  // Same-origin WebSocket. In dev, Vite at :3540 proxies /cable to the
  // Go server at :3550 (configured in vite.config.ts).
  const url = new URL('/cable', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(url.toString())

  socket.onopen = () => {
    reconnectDelay = 500
  }
  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as CableMessage
      for (const listener of listeners) listener(msg)
    } catch {
      // Malformed frame — drop it. Nothing useful we can do.
    }
  }
  socket.onclose = () => {
    socket = undefined
    if (listeners.size === 0) return
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 8000)
      ensureSocket()
    }, reconnectDelay)
  }
  socket.onerror = () => {
    // onclose fires next; defer reconnect logic there.
  }
}

/**
 * Subscribe to inbound cable frames. Returns an unsubscribe function.
 * Calling subscribe again piggybacks on the same WebSocket; the
 * connection closes when the last listener unsubscribes.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  ensureSocket()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      socket?.close()
      socket = undefined
    }
  }
}
