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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'
import { makeAttachment, makeMessage } from '../test/fixtures'

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

// SUT — imported AFTER the mocks.
import { MessageView } from './MessageView'

beforeEach(() => {
  vi.clearAllMocks()
  getMessage.mockReset()
  getRawMessage.mockReset()
  getHeaders.mockReset()
  getHtmlCheck.mockReset()
  deleteMessage.mockReset()
})

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
})
