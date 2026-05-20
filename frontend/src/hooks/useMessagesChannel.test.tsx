import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

/**
 * useMessagesChannel is the React-side wrapper around cable.subscribe.
 * It carries the *defensive fix* for the favicon-counter doubling
 * regression: subscribe exactly once per consumer mount, regardless of
 * how often the parent re-renders or whether the caller forgot to
 * useCallback its handlers.
 *
 * This file pins that contract so the regression can't sneak back in.
 */

// Replace cable.ts with a tiny stub that records subscribe/unsubscribe
// activity, so we can assert on the count without needing a real
// WebSocket.
const subscribeSpy = vi.fn<
  (listener: (msg: { type: string; message?: unknown; id?: string }) => void) => () => void
>()
let activeListeners: Array<(msg: { type: string; message?: unknown; id?: string }) => void> = []
let reconnectListeners: Array<() => void> = []

vi.mock('../lib/cable', () => {
  return {
    subscribe: (listener: (msg: { type: string; message?: unknown; id?: string }) => void) => {
      subscribeSpy(listener)
      activeListeners.push(listener)
      return () => {
        activeListeners = activeListeners.filter((l) => l !== listener)
      }
    },
    subscribeReconnect: (handler: () => void) => {
      reconnectListeners.push(handler)
      return () => {
        reconnectListeners = reconnectListeners.filter((h) => h !== handler)
      }
    },
  }
})

beforeEach(() => {
  subscribeSpy.mockClear()
  activeListeners = []
  reconnectListeners = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useMessagesChannel', () => {
  it('subscribes exactly once on mount', async () => {
    const { useMessagesChannel } = await import('./useMessagesChannel')
    renderHook(() => useMessagesChannel({ onCreated: vi.fn() }))
    expect(subscribeSpy).toHaveBeenCalledTimes(1)
    expect(activeListeners).toHaveLength(1)
  })

  it('does NOT resubscribe when the parent re-renders with a new (non-memoised) handler', async () => {
    const { useMessagesChannel } = await import('./useMessagesChannel')

    const { rerender } = renderHook(
      ({ count }: { count: number }) =>
        useMessagesChannel({
          onCreated: () => {
            // identity changes every render; the hook MUST NOT
            // resubscribe in response, or every parent render would
            // double-count via the listener-set leak we used to have.
            void count
          },
        }),
      { initialProps: { count: 0 } },
    )

    rerender({ count: 1 })
    rerender({ count: 2 })
    rerender({ count: 3 })

    // ONE subscribe across four renders.
    expect(subscribeSpy).toHaveBeenCalledTimes(1)
    expect(activeListeners).toHaveLength(1)
  })

  it("dispatches 'created' frames to onCreated using the LATEST callback identity", async () => {
    const { useMessagesChannel } = await import('./useMessagesChannel')

    const cb1 = vi.fn()
    const cb2 = vi.fn()

    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useMessagesChannel({ onCreated: cb }),
      { initialProps: { cb: cb1 } },
    )

    // After mount, fire a frame — only cb1 has been wired.
    act(() => {
      activeListeners[0]?.({ type: 'created', message: { id: 'm1' } })
    })
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).not.toHaveBeenCalled()

    // Re-render with a different callback. The subscription stays put
    // (no second subscribe), but the *identity* the dispatcher reads
    // for the next frame must be the new one.
    rerender({ cb: cb2 })
    act(() => {
      activeListeners[0]?.({ type: 'created', message: { id: 'm2' } })
    })
    expect(cb1).toHaveBeenCalledTimes(1) // unchanged
    expect(cb2).toHaveBeenCalledTimes(1)
    expect(subscribeSpy).toHaveBeenCalledTimes(1) // still ONE subscribe
  })

  it('unsubscribes on unmount', async () => {
    const { useMessagesChannel } = await import('./useMessagesChannel')
    const { unmount } = renderHook(() =>
      useMessagesChannel({ onCreated: vi.fn() }),
    )
    expect(activeListeners).toHaveLength(1)
    unmount()
    expect(activeListeners).toHaveLength(0)
  })

  it("ignores 'destroyed' frames when no onDestroyed is provided", async () => {
    const { useMessagesChannel } = await import('./useMessagesChannel')
    const onCreated = vi.fn()
    renderHook(() => useMessagesChannel({ onCreated }))

    act(() => {
      activeListeners[0]?.({ type: 'destroyed', id: 'x' })
    })
    expect(onCreated).not.toHaveBeenCalled() // wrong type, ignored
    // No throw, no console error — the hook handles "no handler for
    // this frame type" cleanly.
  })

  it('routes destroyed frames to onDestroyed when both are provided', async () => {
    const { useMessagesChannel } = await import('./useMessagesChannel')
    const onCreated = vi.fn()
    const onDestroyed = vi.fn()
    renderHook(() => useMessagesChannel({ onCreated, onDestroyed }))

    act(() => {
      activeListeners[0]?.({ type: 'destroyed', id: 'gone' })
    })
    expect(onDestroyed).toHaveBeenCalledWith('gone')
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('fires onReconnect when the cable signals a reconnect', async () => {
    const { useMessagesChannel } = await import('./useMessagesChannel')
    const onReconnect = vi.fn()
    renderHook(() => useMessagesChannel({ onReconnect }))

    expect(reconnectListeners).toHaveLength(1)
    act(() => {
      reconnectListeners[0]?.()
    })
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })
})
