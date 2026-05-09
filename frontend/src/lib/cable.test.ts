import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest'

/**
 * cable.ts owns the single WebSocket connection per page that delivers
 * `created` / `destroyed` frames to subscribers (Sidebar + the favicon
 * unread badge). The earlier "(2) Mailtrap Local" double-count
 * regression came from listener-set bookkeeping going wrong here, so
 * this test file pins the contract:
 *
 *   - a single subscribe creates exactly one WebSocket
 *   - multiple subscribers share one connection
 *   - one inbound frame fans out once per listener
 *   - last-unsubscribe closes the socket
 *   - reconnect on close, with growing backoff, only when subscribers remain
 *
 * cable.ts holds module-level state (socket + listeners) — we have to
 * reset that between tests via vi.resetModules() so each test gets a
 * fresh module graph.
 */

// ---------------------------------------------------------------------
// Fake WebSocket — covers the surface cable.ts touches: constructor,
// onopen/onmessage/onclose/onerror, readyState, close().
// ---------------------------------------------------------------------
class FakeWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static CLOSING = 2
  static CONNECTING = 0
  static instances: FakeWebSocket[] = []

  url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  // Helpers tests use to drive the lifecycle.
  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }
  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
  simulateClose() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  // @ts-expect-error — replacing the global for the test
  globalThis.WebSocket = FakeWebSocket
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

describe('cable.subscribe', () => {
  it('opens exactly one WebSocket on first subscribe', async () => {
    const { subscribe } = await import('./cable')
    subscribe(() => {})
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('reuses a single connection across multiple subscribers', async () => {
    const { subscribe } = await import('./cable')
    subscribe(() => {})
    subscribe(() => {})
    subscribe(() => {})
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('dispatches each inbound frame to every active listener exactly once', async () => {
    const { subscribe } = await import('./cable')
    const a = vi.fn()
    const b = vi.fn()
    subscribe(a)
    subscribe(b)
    FakeWebSocket.instances[0].simulateOpen()
    FakeWebSocket.instances[0].simulateMessage({
      type: 'created',
      message: { id: 'm1' },
    })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(a.mock.calls[0][0]).toEqual({
      type: 'created',
      message: { id: 'm1' },
    })
  })

  it('does NOT fire stale listeners after they unsubscribe', async () => {
    const { subscribe } = await import('./cable')
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = subscribe(a)
    subscribe(b)
    unsubA() // a is removed; b still active

    FakeWebSocket.instances[0].simulateOpen()
    FakeWebSocket.instances[0].simulateMessage({ type: 'destroyed', id: 'x' })

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('closes the socket when the last subscriber unsubscribes', async () => {
    const { subscribe } = await import('./cable')
    const closeSpy = vi.spyOn(FakeWebSocket.prototype, 'close')
    const unsub = subscribe(() => {})
    expect(FakeWebSocket.instances).toHaveLength(1)
    unsub()
    expect(closeSpy).toHaveBeenCalled()
  })

  it('drops malformed frames silently — survives bad JSON without crashing other listeners', async () => {
    const { subscribe } = await import('./cable')
    const listener = vi.fn()
    subscribe(listener)
    const ws = FakeWebSocket.instances[0]
    ws.simulateOpen()

    // Inject raw bad JSON manually — bypassing simulateMessage's
    // JSON.stringify wrapper.
    ws.onmessage?.(new MessageEvent('message', { data: '<not json>' }))
    expect(listener).not.toHaveBeenCalled()

    // The listener still works for subsequent good frames.
    ws.simulateMessage({ type: 'created', message: { id: 'm2' } })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reconnects after a close with subscribers still present', async () => {
    const { subscribe } = await import('./cable')
    subscribe(() => {})
    expect(FakeWebSocket.instances).toHaveLength(1)
    FakeWebSocket.instances[0].simulateOpen()
    FakeWebSocket.instances[0].simulateClose()

    // First reconnect after 500ms (initial backoff).
    vi.advanceTimersByTime(600)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('does NOT reconnect when the close happens after every subscriber left', async () => {
    const { subscribe } = await import('./cable')
    const unsub = subscribe(() => {})
    unsub()

    // unsub() called close(), but it doesn't fire an automatic onclose
    // event. We have to simulate it manually for this test.
    FakeWebSocket.instances[0].simulateClose()
    vi.advanceTimersByTime(2000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})

// Sanity-check the test mock itself so a future regression in WebSocket
// type erasure doesn't silently make every cable test pass-by-default.
describe('FakeWebSocket', () => {
  it('records every constructed instance', () => {
    const a = new FakeWebSocket('ws://x') as unknown as { url: string }
    const b = new FakeWebSocket('ws://y') as unknown as { url: string }
    expect(FakeWebSocket.instances).toEqual([a, b])
  })

  it('OPEN / CLOSED / CONNECTING / CLOSING constants align with the real WebSocket', () => {
    // Pin the numeric values cable.ts depends on — switching the mock
    // to a different lib that uses different constants would silently
    // break the readyState branch in ensureSocket().
    expect(FakeWebSocket.CONNECTING).toBe(0)
    expect(FakeWebSocket.OPEN).toBe(1)
    expect(FakeWebSocket.CLOSING).toBe(2)
    expect(FakeWebSocket.CLOSED).toBe(3)
  })
})

// Suppress unused-mock import lint hint
const _: Mock = vi.fn() as unknown as Mock
void _
