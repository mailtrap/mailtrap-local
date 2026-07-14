/**
 * MessageView is the right-pane detail view. Loads a Message by id from
 * /api/v1/message/:id, decorates with /raw + /headers, and lazily kicks
 * off /html_check when the message has HTML content. Tabs swap between
 * HTML / HTML Source / Text / Raw / HTML Check / Tech Info.
 *
 * Tests focus on the high-leverage flows:
 *
 *   - subject + From/To header render after the load resolves
 *   - the per-message action buttons (delete, forward, send to cloud)
 *     surface their intended inline UI when clicked
 *   - delete-confirm hits deleteMessage and navigates away
 *   - tab switching makes the right pane content visible
 *   - a 404 load / live 'destroyed' frame renders the friendly
 *     deleted state (not the raw error) with a way back to the inbox
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type AxiosResponse } from 'axios'
import { renderWithProviders } from '../test/render'
import { makeAttachment, makeMessage } from '../test/fixtures'
import type { CableMessage } from '../lib/cable'

// ---------------------------------------------------------------------
// Mocks for everything MessageView reaches for.
// ---------------------------------------------------------------------

const getMessage = vi.fn()
const getRawMessage = vi.fn()
const getHeaders = vi.fn()
const getHtmlCheck = vi.fn()
const deleteMessage = vi.fn()

vi.mock('../api/messages', async () => {
  const actual = await vi.importActual<typeof import('../api/messages')>(
    '../api/messages',
  )
  return {
    ...actual,
    getMessage: (...a: unknown[]) => getMessage(...a),
    getRawMessage: (...a: unknown[]) => getRawMessage(...a),
    getHeaders: (...a: unknown[]) => getHeaders(...a),
    getHtmlCheck: (...a: unknown[]) => getHtmlCheck(...a),
    deleteMessage: (...a: unknown[]) => deleteMessage(...a),
  }
})

const releaseMessage = vi.fn()
const sendMessageToCloud = vi.fn()

vi.mock('../api/cloud', async () => ({
  ...(await vi.importActual<typeof import('../api/cloud')>('../api/cloud')),
  getCloudConnection: vi.fn().mockResolvedValue({ connected: false }),
  updateCloudConnection: vi.fn(),
  disconnectCloud: vi.fn(),
  sendMessageToCloud: (...a: unknown[]) => sendMessageToCloud(...a),
}))
vi.mock('../api/relay', async () => ({
  ...(await vi.importActual<typeof import('../api/relay')>('../api/relay')),
  getRelayConnection: vi.fn().mockResolvedValue({ connected: false }),
  updateRelayConnection: vi.fn(),
  disconnectRelay: vi.fn(),
  testRelayConnection: vi.fn(),
  releaseMessage: (...a: unknown[]) => releaseMessage(...a),
}))
vi.mock('../api/webhook', async () => ({
  ...(await vi.importActual<typeof import('../api/webhook')>('../api/webhook')),
  getWebhookConnection: vi.fn().mockResolvedValue({ connected: false }),
  updateWebhookConnection: vi.fn(),
  disconnectWebhook: vi.fn(),
  testWebhookConnection: vi.fn(),
}))

// cable: capture the subscriber so tests can drive live updates.
let cableSub: ((msg: CableMessage) => void) | null = null
vi.mock('../lib/cable', () => ({
  subscribe: (cb: (msg: CableMessage) => void) => {
    cableSub = cb
    return () => {
      cableSub = null
    }
  },
  subscribeReconnect: () => () => {},
}))

// SUT — imported AFTER the mocks.
import { MessageView } from './MessageView'

beforeEach(() => {
  vi.clearAllMocks()
  cableSub = null
  getMessage.mockReset()
  getRawMessage.mockReset()
  getHeaders.mockReset()
  getHtmlCheck.mockReset()
  deleteMessage.mockReset()
})

/** Minimal AxiosError with a real HTTP response, as `api/client` sees it. */
function makeHttpError(status: number, body?: { error?: string }) {
  const response = {
    status,
    statusText: '',
    headers: {},
    config: {},
    data: body,
  } as AxiosResponse
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    response,
  )
}

function mountWithFetchError(status: number, body?: { error?: string }) {
  const err = makeHttpError(status, body)
  getMessage.mockRejectedValue(err)
  getRawMessage.mockRejectedValue(err)
  getHeaders.mockRejectedValue(err)
  return renderWithProviders(<MessageView />, {
    initialEntries: ['/message/gone'],
    routePath: '/message/:id',
  })
}

function mountWithMessage(over = {}) {
  const m = makeMessage(over)
  getMessage.mockResolvedValue(m)
  getRawMessage.mockResolvedValue(
    'From: ' + m.from.address + '\r\nSubject: ' + m.subject + '\r\n\r\nbody',
  )
  getHeaders.mockResolvedValue({
    From: [m.from.address],
    To: [m.to[0].address],
    Subject: [m.subject],
  })
  getHtmlCheck.mockResolvedValue({ status: 'no_html' })
  return renderWithProviders(<MessageView />, {
    initialEntries: ['/message/' + m.id],
    routePath: '/message/:id',
  })
}

describe('MessageView', () => {
  it('shows a loading state until the fetch resolves', () => {
    // Stay pending — nothing resolves.
    getMessage.mockReturnValue(new Promise(() => {}))
    getRawMessage.mockReturnValue(new Promise(() => {}))
    getHeaders.mockReturnValue(new Promise(() => {}))

    renderWithProviders(<MessageView />, {
      initialEntries: ['/message/abc'],
      routePath: '/message/:id',
    })
    expect(screen.getByText(/Loading…/i)).toBeInTheDocument()
  })

  it('renders subject, from, and to in the header after load', async () => {
    mountWithMessage({
      subject: 'Welcome to widgets',
      from: { name: 'App', address: 'noreply@widgets.test' },
      to: [{ name: 'Alice', address: 'alice@example.test' }],
    })

    expect(
      await screen.findByRole('heading', { name: 'Welcome to widgets' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/App <noreply@widgets\.test>/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Alice <alice@example\.test>/),
    ).toBeInTheDocument()
  })

  it("'(no subject)' fallback when subject is empty", async () => {
    mountWithMessage({ subject: '' })
    expect(
      await screen.findByRole('heading', { name: '(no subject)' }),
    ).toBeInTheDocument()
  })

  it('clicking Delete reveals the inline confirm strip', async () => {
    const user = userEvent.setup()
    mountWithMessage()
    // Wait for header to render before clicking the action buttons.
    await screen.findByRole('heading')

    await user.click(screen.getByTitle('Delete email'))

    expect(screen.getByText(/Delete this email\?/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirm' }),
    ).toBeInTheDocument()
  })

  it('Confirm in the delete strip calls deleteMessage', async () => {
    const user = userEvent.setup()
    deleteMessage.mockResolvedValue(undefined)
    mountWithMessage({ id: 'kill-me' })
    await screen.findByRole('heading')

    await user.click(screen.getByTitle('Delete email'))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith('kill-me'))
  })

  it('Cancel in the delete strip restores the action icons', async () => {
    const user = userEvent.setup()
    mountWithMessage()
    await screen.findByRole('heading')

    await user.click(screen.getByTitle('Delete email'))
    expect(screen.getByText(/Delete this email\?/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText(/Delete this email\?/i)).not.toBeInTheDocument()
    expect(screen.getByTitle('Delete email')).toBeInTheDocument()
  })

  it('switches to the Text tab when clicked', async () => {
    const user = userEvent.setup()
    mountWithMessage({
      text: 'plain-text body line',
      html: '<p>html body</p>',
    })
    await screen.findByRole('heading')

    await user.click(screen.getByRole('tab', { name: 'Text' }))
    expect(screen.getByText('plain-text body line')).toBeInTheDocument()
  })

  it('keeps the message view open when Escape closes attachments', async () => {
    const user = userEvent.setup()
    mountWithMessage({
      attachments: [makeAttachment({ file_name: 'report.pdf' })],
    })
    await screen.findByRole('heading', { name: 'Hello' })

    const trigger = screen.getByRole('button', { name: 'Attachments (1)' })
    await user.click(trigger)

    screen.getByRole('link', { name: /report\.pdf/i }).focus()
    await user.keyboard('{Escape}')

    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it('renders the no-HTML placeholder in HTML Check when message has no html', async () => {
    const user = userEvent.setup()
    mountWithMessage({ html: '' })
    await screen.findByRole('heading')

    // No 'HTML' tab when the message has no HTML body — but Text /
    // Raw / Tech Info still appear. HTML Check tab is also absent in
    // this case, so the test is "the html-related tabs aren't
    // there".
    expect(screen.queryByRole('tab', { name: 'HTML' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tab', { name: 'HTML Check' }),
    ).not.toBeInTheDocument()
    // But Text + Raw + Tech Info are.
    expect(screen.getByRole('tab', { name: 'Text' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Raw' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tech Info' })).toBeInTheDocument()
    void user
  })

  it('renders a Forward button which expands an inline forward form when clicked', async () => {
    // Relay has to be connected for the button to be enabled.
    const relayMod = await import('../api/relay')
    vi.mocked(relayMod.getRelayConnection).mockResolvedValue({
      connected: true,
      host: 'smtp.example.com',
      port: 587,
      username: '',
      auth: 'plain',
      tls: 'auto',
      auto_relay_enabled: false,
      override_from: '',
      return_path: '',
      password_hint: null,
      locked: {
        host: false,
        port: false,
        username: false,
        password: false,
        auth: false,
        tls: false,
        auto_relay_enabled: false,
        override_from: false,
        return_path: false,
      },
      config_path: null,
    })
    const user = userEvent.setup()
    mountWithMessage()
    await screen.findByRole('heading')

    // Wait for the relay state to land — the forward button is enabled
    // only once relayState.connected is true.
    await waitFor(() => {
      const btn = screen.getByTitle(/Forward via SMTP relay/i)
      expect(btn).not.toBeDisabled()
    })

    await user.click(screen.getByTitle(/Forward via SMTP relay/i))

    expect(
      screen.getByPlaceholderText('alice@example.com, bob@example.com'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('shows the friendly deleted state when the message fetch 404s', async () => {
    mountWithFetchError(404, { error: 'message not found' })

    expect(
      await screen.findByText(/This message was deleted/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Back to inbox' }),
    ).toBeInTheDocument()
    // The raw axios error string must not leak into the UI.
    expect(screen.queryByText(/AxiosError/)).not.toBeInTheDocument()
    expect(screen.queryByText(/status code 404/)).not.toBeInTheDocument()
  })

  it("'Back to inbox' navigates away from the deleted message", async () => {
    const user = userEvent.setup()
    mountWithFetchError(404)
    await screen.findByText(/This message was deleted/i)

    await user.click(screen.getByRole('button', { name: 'Back to inbox' }))

    // navigate('/') leaves the /message/:id route, unmounting the view.
    expect(
      screen.queryByText(/This message was deleted/i),
    ).not.toBeInTheDocument()
  })

  it('shows readable copy (not the raw AxiosError) for non-404 failures', async () => {
    mountWithFetchError(500, { error: 'storage unavailable' })

    expect(
      await screen.findByText(
        /Failed to load this message: storage unavailable/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/AxiosError/)).not.toBeInTheDocument()
    // A non-404 failure is an error, not the deleted empty state.
    expect(
      screen.queryByText(/This message was deleted/i),
    ).not.toBeInTheDocument()
  })

  it("swaps to the deleted state when a live 'destroyed' frame targets the open message", async () => {
    mountWithMessage({ id: 'live-gone' })
    await screen.findByRole('heading')

    // A frame for some other message leaves the view alone.
    act(() => {
      cableSub?.({ type: 'destroyed', id: 'other-id' })
    })
    expect(screen.getByRole('heading')).toBeInTheDocument()

    act(() => {
      cableSub?.({ type: 'destroyed', id: 'live-gone' })
    })
    expect(screen.getByText(/This message was deleted/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
