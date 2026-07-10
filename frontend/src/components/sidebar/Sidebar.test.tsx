/**
 * Sidebar is the persistent message-list pane. It pulls the inbox via
 * /api/v1/messages, accepts live updates via the cable hook, and ships
 * a debounced search box that hits /api/v1/search. These tests pin the
 * three highest-leverage flows:
 *
 *   1. fetch + render the list on mount
 *   2. live "created" frames prepend a row, "destroyed" frames remove one
 *   3. search input debounces, then displays server results
 *   4. scrolling near the bottom pages in the rest of the list (and the
 *      rest of the search results) with dedupe + stale-append guards
 *
 * We mock every network module the providers + Sidebar reach for, plus
 * the cable subscription. The mocks live at module scope (vi.mock
 * hoists them above imports), with per-test shaping done via the spy
 * `mockResolvedValue` calls inside each `it`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../test/render'
import { makeSummary } from '../../test/fixtures'
import type { CableMessage } from '../../lib/cable'
import type { MessagesResponse } from '../../api/messages'

// ---------------------------------------------------------------------
// Mocks. The Sidebar reaches for:
//   - api/messages (getMessages, deleteAllMessages, markAllRead, searchMessages)
//   - api/cloud / api/relay / api/webhook (via the three provider hooks)
//   - lib/cable (live updates)
// ---------------------------------------------------------------------

const getMessages = vi.fn()
const searchMessages = vi.fn()
const deleteAllMessages = vi.fn()
const markAllRead = vi.fn()

vi.mock('../../api/messages', async () => {
  const actual = await vi.importActual<typeof import('../../api/messages')>(
    '../../api/messages',
  )
  return {
    ...actual,
    getMessages: (...args: unknown[]) => getMessages(...args),
    searchMessages: (...args: unknown[]) => searchMessages(...args),
    deleteAllMessages: (...args: unknown[]) => deleteAllMessages(...args),
    markAllRead: (...args: unknown[]) => markAllRead(...args),
  }
})

// Connection providers ping the API on mount. Stub the three readers
// with empty/defaults so the providers settle without network errors.
vi.mock('../../api/cloud', async () => ({
  ...(await vi.importActual<typeof import('../../api/cloud')>('../../api/cloud')),
  getCloudConnection: vi.fn().mockResolvedValue({ connected: false }),
  updateCloudConnection: vi.fn(),
  disconnectCloud: vi.fn(),
}))
vi.mock('../../api/relay', async () => ({
  ...(await vi.importActual<typeof import('../../api/relay')>('../../api/relay')),
  getRelayConnection: vi.fn().mockResolvedValue({ connected: false }),
  updateRelayConnection: vi.fn(),
  disconnectRelay: vi.fn(),
  testRelayConnection: vi.fn(),
}))
vi.mock('../../api/webhook', async () => ({
  ...(await vi.importActual<typeof import('../../api/webhook')>('../../api/webhook')),
  getWebhookConnection: vi.fn().mockResolvedValue({ connected: false }),
  updateWebhookConnection: vi.fn(),
  disconnectWebhook: vi.fn(),
  testWebhookConnection: vi.fn(),
}))

// cable: capture the subscriber so tests can drive live updates.
let cableSub: ((msg: CableMessage) => void) | null = null
vi.mock('../../lib/cable', () => {
  return {
    subscribe: (cb: (msg: CableMessage) => void) => {
      cableSub = cb
      return () => {
        cableSub = null
      }
    },
    subscribeReconnect: () => () => {},
  }
})

// SUT — imported AFTER the mocks above so the SUT picks them up.
import { Sidebar } from './Sidebar'

const emptyResp = {
  total: 0,
  unread: 0,
  count: 0,
  messages_count: 0,
  messages_unread: 0,
  start: 0,
  tags: [],
  messages: [],
}

beforeEach(() => {
  cableSub = null
  getMessages.mockReset()
  searchMessages.mockReset()
  deleteAllMessages.mockReset()
  markAllRead.mockReset()
})

/**
 * The scrollable pane wrapping the message <ul>. jsdom reports zero
 * scroll metrics, so a bare fireEvent.scroll() lands "near the bottom"
 * — tests that need the opposite override the metrics explicitly.
 */
function scrollPane(): HTMLElement {
  return screen.getByRole('list').parentElement as HTMLElement
}

/** Message-row links only (the footer also renders a <Link>). */
function messageRows(): HTMLElement[] {
  return screen
    .queryAllByRole('link')
    .filter((el) => el.getAttribute('href')?.startsWith('/message/'))
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('Sidebar', () => {
  it('renders the empty state when the inbox has no messages', async () => {
    getMessages.mockResolvedValue(emptyResp)
    renderWithProviders(<Sidebar />)
    expect(await screen.findByText(/No messages yet/i)).toBeInTheDocument()
    expect(getMessages).toHaveBeenCalledOnce()
  })

  it('renders one row per message after the initial fetch', async () => {
    const messages = [
      makeSummary({ id: 'a', subject: 'Welcome', tags: ['onboarding'] }),
      makeSummary({ id: 'b', subject: 'Receipt #1', tags: ['receipts'] }),
      makeSummary({ id: 'c', subject: 'Password reset' }),
    ]
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 3,
      count: 3,
      messages,
    })
    renderWithProviders(<Sidebar />)

    expect(await screen.findByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Receipt #1')).toBeInTheDocument()
    expect(screen.getByText('Password reset')).toBeInTheDocument()
    // Category pill from message tags.
    expect(screen.getByText('onboarding')).toBeInTheDocument()
  })

  it("prepends a row when a 'created' frame arrives over the cable", async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 1,
      count: 1,
      messages: [makeSummary({ id: 'old', subject: 'Existing' })],
    })
    renderWithProviders(<Sidebar />)
    expect(await screen.findByText('Existing')).toBeInTheDocument()

    // Drive the cable hook directly.
    const fresh = makeSummary({ id: 'new', subject: 'Just landed' })
    act(() => {
      cableSub?.({ type: 'created', message: fresh })
    })
    expect(await screen.findByText('Just landed')).toBeInTheDocument()
    // Existing row stays.
    expect(screen.getByText('Existing')).toBeInTheDocument()
  })

  it("removes a row when a 'destroyed' frame arrives over the cable", async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 2,
      count: 2,
      messages: [
        makeSummary({ id: 'k', subject: 'Keep' }),
        makeSummary({ id: 'g', subject: 'Goes away' }),
      ],
    })
    renderWithProviders(<Sidebar />)
    expect(await screen.findByText('Goes away')).toBeInTheDocument()

    act(() => {
      cableSub?.({ type: 'destroyed', id: 'g' })
    })
    await waitFor(() => {
      expect(screen.queryByText('Goes away')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Keep')).toBeInTheDocument()
  })

  it('debounces search input and displays the server results', async () => {
    getMessages.mockResolvedValue(emptyResp)
    searchMessages.mockResolvedValue({
      ...emptyResp,
      total: 1,
      count: 1,
      messages: [makeSummary({ id: 's', subject: 'Search hit' })],
    })

    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await screen.findByText(/No messages yet/i)

    await user.type(screen.getByPlaceholderText('Search…'), 'welcome')

    await waitFor(() => expect(searchMessages).toHaveBeenCalled(), {
      timeout: 1500,
    })
    expect(searchMessages.mock.calls[0][0]).toMatchObject({
      query: 'welcome',
    })
    expect(await screen.findByText('Search hit')).toBeInTheDocument()
  })

  it('renders the in-pane "Delete all messages?" confirm strip on click', async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 1,
      count: 1,
      messages: [makeSummary({ id: 'x', subject: 'Some' })],
    })
    deleteAllMessages.mockResolvedValue(undefined)

    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await screen.findByText('Some')

    await user.click(screen.getByTitle('Delete all messages'))

    // Inline confirm strip is visible (replaces the native confirm()).
    expect(
      await screen.findByText(/Delete all 1 messages\?/i),
    ).toBeInTheDocument()
    const confirmBtn = screen.getByRole('button', { name: 'Confirm' })

    // Subsequent fetch returns empty so the list re-renders empty.
    getMessages.mockResolvedValueOnce(emptyResp)
    await user.click(confirmBtn)

    await waitFor(() => expect(deleteAllMessages).toHaveBeenCalled())
  })

  it('Mark-all-read sends the markAllRead request', async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 1,
      count: 1,
      messages: [makeSummary({ id: 'r', subject: 'Unread' })],
    })
    markAllRead.mockResolvedValue(undefined)

    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await screen.findByText('Unread')

    // Mark all read button — refetch happens after, so stage another response.
    getMessages.mockResolvedValueOnce({
      ...emptyResp,
      total: 1,
      count: 1,
      messages: [makeSummary({ id: 'r', subject: 'Unread', read: true })],
    })

    await user.click(screen.getByTitle('Mark all as read'))
    await waitFor(() => expect(markAllRead).toHaveBeenCalled())
  })

  it('de-dupes a "created" frame whose id is already in the list', async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 1,
      count: 1,
      messages: [makeSummary({ id: 'shared', subject: 'Original' })],
    })
    renderWithProviders(<Sidebar />)
    await screen.findByText('Original')

    // Same id, different subject — the dedup guard should keep the
    // original row instead of stacking a duplicate.
    act(() => {
      cableSub?.({
        type: 'created',
        message: makeSummary({ id: 'shared', subject: 'Should be ignored' }),
      })
    })

    // Wait a microtask to let any setState flush, then assert.
    await waitFor(() => {
      expect(messageRows().length).toBe(1)
    })
    expect(screen.getByText('Original')).toBeInTheDocument()
    expect(screen.queryByText('Should be ignored')).not.toBeInTheDocument()
  })

  it('fetches the next page and appends it when scrolled near the bottom', async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 4,
      count: 2,
      messages: [
        makeSummary({ id: 'a', subject: 'First page A' }),
        makeSummary({ id: 'b', subject: 'First page B' }),
      ],
    })
    renderWithProviders(<Sidebar />)
    await screen.findByText('First page A')

    getMessages.mockResolvedValueOnce({
      ...emptyResp,
      total: 4,
      count: 2,
      start: 2,
      messages: [
        makeSummary({ id: 'c', subject: 'Second page C' }),
        makeSummary({ id: 'd', subject: 'Second page D' }),
      ],
    })
    fireEvent.scroll(scrollPane())

    expect(await screen.findByText('Second page C')).toBeInTheDocument()
    expect(screen.getByText('Second page D')).toBeInTheDocument()
    // First page rows stay put above the appended ones.
    expect(screen.getByText('First page A')).toBeInTheDocument()
    expect(getMessages).toHaveBeenCalledTimes(2)
    expect(getMessages.mock.calls[1][0]).toMatchObject({
      start: 2,
      limit: 100,
    })
  })

  it('does not fetch another page once the whole list is loaded', async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 2,
      count: 2,
      messages: [
        makeSummary({ id: 'a', subject: 'Row A' }),
        makeSummary({ id: 'b', subject: 'Row B' }),
      ],
    })
    renderWithProviders(<Sidebar />)
    await screen.findByText('Row A')

    fireEvent.scroll(scrollPane())
    await act(async () => {})
    expect(getMessages).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not fetch while the scroll position is far from the bottom', async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 4,
      count: 2,
      messages: [
        makeSummary({ id: 'a', subject: 'Row A' }),
        makeSummary({ id: 'b', subject: 'Row B' }),
      ],
    })
    renderWithProviders(<Sidebar />)
    await screen.findByText('Row A')

    const pane = scrollPane()
    Object.defineProperty(pane, 'scrollHeight', {
      value: 1000,
      configurable: true,
    })
    Object.defineProperty(pane, 'clientHeight', {
      value: 400,
      configurable: true,
    })
    Object.defineProperty(pane, 'scrollTop', {
      value: 100,
      configurable: true,
    })
    fireEvent.scroll(pane)
    await act(async () => {})
    expect(getMessages).toHaveBeenCalledTimes(1)
  })

  it('shows a loading row while the next page is in flight', async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 4,
      count: 2,
      messages: [
        makeSummary({ id: 'a', subject: 'First page A' }),
        makeSummary({ id: 'b', subject: 'First page B' }),
      ],
    })
    renderWithProviders(<Sidebar />)
    await screen.findByText('First page A')

    let resolvePage!: (v: MessagesResponse) => void
    getMessages.mockImplementationOnce(
      () =>
        new Promise<MessagesResponse>((res) => {
          resolvePage = res
        }),
    )
    fireEvent.scroll(scrollPane())
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Loading more/i,
    )

    await act(async () => {
      resolvePage({
        ...emptyResp,
        total: 4,
        count: 2,
        start: 2,
        messages: [makeSummary({ id: 'c', subject: 'Second page C' })],
      })
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Second page C')).toBeInTheDocument()
  })

  it('dedupes a page overlap caused by a live prepend mid-fetch', async () => {
    getMessages.mockResolvedValue({
      ...emptyResp,
      total: 3,
      count: 2,
      messages: [
        makeSummary({ id: 'a', subject: 'First page A' }),
        makeSummary({ id: 'b', subject: 'First page B' }),
      ],
    })
    renderWithProviders(<Sidebar />)
    await screen.findByText('First page A')

    let resolvePage!: (v: MessagesResponse) => void
    getMessages.mockImplementationOnce(
      () =>
        new Promise<MessagesResponse>((res) => {
          resolvePage = res
        }),
    )
    fireEvent.scroll(scrollPane())

    // A new message lands over the cable while page two is in flight…
    act(() => {
      cableSub?.({
        type: 'created',
        message: makeSummary({ id: 'c', subject: 'Landed live' }),
      })
    })
    expect(await screen.findByText('Landed live')).toBeInTheDocument()

    // …and the prepend shifted server offsets, so the fetched page
    // repeats the same row. The append must drop it.
    await act(async () => {
      resolvePage({
        ...emptyResp,
        total: 4,
        count: 2,
        start: 2,
        messages: [
          makeSummary({ id: 'c', subject: 'Landed live' }),
          makeSummary({ id: 'd', subject: 'Tail row' }),
        ],
      })
    })
    expect(screen.getByText('Tail row')).toBeInTheDocument()
    expect(screen.getAllByText('Landed live')).toHaveLength(1)
    expect(messageRows()).toHaveLength(4)
  })

  it('paginates search results with a start offset', async () => {
    getMessages.mockResolvedValue(emptyResp)
    searchMessages.mockResolvedValueOnce({
      ...emptyResp,
      total: 3,
      count: 2,
      messages: [
        makeSummary({ id: 's1', subject: 'Search hit 1' }),
        makeSummary({ id: 's2', subject: 'Search hit 2' }),
      ],
    })

    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await screen.findByText(/No messages yet/i)

    await user.type(screen.getByPlaceholderText('Search…'), 'welcome')
    expect(
      await screen.findByText('Search hit 1', undefined, { timeout: 1500 }),
    ).toBeInTheDocument()

    searchMessages.mockResolvedValueOnce({
      ...emptyResp,
      total: 3,
      count: 1,
      start: 2,
      messages: [makeSummary({ id: 's3', subject: 'Search hit 3' })],
    })
    fireEvent.scroll(scrollPane())

    expect(await screen.findByText('Search hit 3')).toBeInTheDocument()
    expect(screen.getByText('Search hit 1')).toBeInTheDocument()
    expect(searchMessages).toHaveBeenCalledTimes(2)
    expect(searchMessages.mock.calls[1][0]).toMatchObject({
      query: 'welcome',
      start: 2,
      limit: 100,
    })
  })

  it('discards a stale search page when the query changes mid-flight', async () => {
    getMessages.mockResolvedValue(emptyResp)
    searchMessages.mockResolvedValueOnce({
      ...emptyResp,
      total: 4,
      count: 2,
      messages: [
        makeSummary({ id: 's1', subject: 'Old hit 1' }),
        makeSummary({ id: 's2', subject: 'Old hit 2' }),
      ],
    })

    const user = userEvent.setup()
    renderWithProviders(<Sidebar />)
    await screen.findByText(/No messages yet/i)

    await user.type(screen.getByPlaceholderText('Search…'), 'foo')
    expect(
      await screen.findByText('Old hit 1', undefined, { timeout: 1500 }),
    ).toBeInTheDocument()

    // Page two for "foo" hangs in flight…
    let resolvePage!: (v: MessagesResponse) => void
    searchMessages.mockImplementationOnce(
      () =>
        new Promise<MessagesResponse>((res) => {
          resolvePage = res
        }),
    )
    // …while the next keystroke re-runs the search with a new query.
    searchMessages.mockResolvedValueOnce({
      ...emptyResp,
      total: 1,
      count: 1,
      messages: [makeSummary({ id: 't1', subject: 'New hit' })],
    })
    fireEvent.scroll(scrollPane())
    await screen.findByRole('status')

    await user.type(screen.getByPlaceholderText('Search…'), 'b')
    expect(
      await screen.findByText('New hit', undefined, { timeout: 1500 }),
    ).toBeInTheDocument()

    // The stale "foo" page resolves after the query changed — its rows
    // must not leak into the "foob" result set.
    await act(async () => {
      resolvePage({
        ...emptyResp,
        total: 4,
        count: 2,
        start: 2,
        messages: [makeSummary({ id: 's3', subject: 'Stale tail' })],
      })
    })
    expect(screen.queryByText('Stale tail')).not.toBeInTheDocument()
    expect(screen.getByText('New hit')).toBeInTheDocument()
  })
})

const _within = within
void _within
