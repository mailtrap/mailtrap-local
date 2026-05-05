import { useEffect } from 'react'
import { subscribe } from '../lib/cable'
import type { MessageSummary } from '../api/messages'

export interface MessagesChannelHandlers {
  onCreated?: (message: MessageSummary) => void
  onDestroyed?: (id: string) => void
}

/**
 * Subscribes to the live message channel and dispatches inbound
 * broadcasts to the supplied callbacks. Re-subscribes only when the
 * handler identity changes — pass stable refs (useCallback) if you
 * want to avoid tearing down the subscription on every render.
 */
export function useMessagesChannel({
  onCreated,
  onDestroyed,
}: MessagesChannelHandlers): void {
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'created') onCreated?.(msg.message)
      else if (msg.type === 'destroyed') onDestroyed?.(msg.id)
    })
  }, [onCreated, onDestroyed])
}
