/**
 * Tests for the three connection dialogs (Cloud / Relay / Webhook).
 * Each dialog follows the same shape:
 *
 *   - reads its connection state from the matching context provider
 *   - opens with the form pre-filled (or blank when unconnected)
 *   - locked-field hints appear when the YAML config pins a value
 *   - Save calls the provider's update(); the form closes; the
 *     resulting state propagates back to consumers
 *
 * One test file covers all three dialogs to share the connection-API
 * mock surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'

// ---------------------------------------------------------------------
// Per-API mocks. vi.mock is hoisted above imports, so the spy objects
// have to be created via vi.hoisted() to be reachable from the factory.
// ---------------------------------------------------------------------

const { cloud, relay, webhook } = vi.hoisted(() => ({
  cloud: {
    getCloudConnection: vi.fn(),
    updateCloudConnection: vi.fn(),
    disconnectCloud: vi.fn(),
    sendMessageToCloud: vi.fn(),
  },
  relay: {
    getRelayConnection: vi.fn(),
    updateRelayConnection: vi.fn(),
    disconnectRelay: vi.fn(),
    testRelayConnection: vi.fn(),
  },
  webhook: {
    getWebhookConnection: vi.fn(),
    updateWebhookConnection: vi.fn(),
    disconnectWebhook: vi.fn(),
    testWebhookConnection: vi.fn(),
  },
}))

vi.mock('../api/cloud', async () => ({
  ...(await vi.importActual<typeof import('../api/cloud')>('../api/cloud')),
  ...cloud,
}))
vi.mock('../api/relay', async () => ({
  ...(await vi.importActual<typeof import('../api/relay')>('../api/relay')),
  ...relay,
}))
vi.mock('../api/webhook', async () => ({
  ...(await vi.importActual<typeof import('../api/webhook')>('../api/webhook')),
  ...webhook,
}))

// SUTs — imported AFTER the mocks.
import CloudConnectDialog from './CloudConnectDialog'
import RelayConnectDialog from './RelayConnectDialog'
import WebhookConnectDialog from './WebhookConnectDialog'

const cloudDisconnected = { connected: false }
const relayDisconnected = {
  connected: false,
  host: null,
  port: 587,
  username: null,
  auth: 'plain',
  tls: 'auto',
  auto_relay_enabled: false,
  override_from: null,
  return_path: null,
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
}
const webhookDisconnected = {
  connected: false,
  url: '',
  enabled: false,
  secret_hint: null,
  locked: { url: false, secret: false, enabled: false },
  config_path: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  cloud.getCloudConnection.mockResolvedValue(cloudDisconnected)
  cloud.updateCloudConnection.mockResolvedValue(undefined)
  cloud.disconnectCloud.mockResolvedValue(undefined)
  relay.getRelayConnection.mockResolvedValue(relayDisconnected)
  relay.updateRelayConnection.mockResolvedValue(undefined)
  relay.disconnectRelay.mockResolvedValue(undefined)
  relay.testRelayConnection.mockResolvedValue({ ok: true, message: 'Connected' })
  webhook.getWebhookConnection.mockResolvedValue(webhookDisconnected)
  webhook.updateWebhookConnection.mockResolvedValue(undefined)
  webhook.disconnectWebhook.mockResolvedValue(undefined)
  webhook.testWebhookConnection.mockResolvedValue({ ok: true, message: 'Sent' })
})

// ---------------------------------------------------------------------
// CloudConnectDialog
// ---------------------------------------------------------------------

describe('CloudConnectDialog', () => {
  it('renders the disconnected form with API token + sandbox ID inputs', async () => {
    renderWithProviders(
      <CloudConnectDialog open onOpenChange={vi.fn()} />,
    )
    expect(
      await screen.findByRole('heading', { name: /Connect to Mailtrap Sandbox/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/API token/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Sandbox ID/i)).toBeInTheDocument()
  })

  it('Save is disabled until both API token and sandbox id are valid', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <CloudConnectDialog open onOpenChange={vi.fn()} />,
    )
    await screen.findByRole('heading', { name: /Connect to Mailtrap Sandbox/i })

    const save = screen.getByRole('button', { name: /Connect/i })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText(/API token/i), 'sandbox-tok-XYZ')
    expect(save).toBeDisabled() // sandbox id still missing

    await user.type(screen.getByLabelText(/Sandbox ID/i), '12345')
    expect(save).toBeEnabled()
  })

  it('clicking Connect sends the API token + sandbox id to update', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <CloudConnectDialog open onOpenChange={vi.fn()} />,
    )
    await screen.findByRole('heading', { name: /Connect to Mailtrap Sandbox/i })

    await user.type(screen.getByLabelText(/API token/i), 'tok-1')
    await user.type(screen.getByLabelText(/Sandbox ID/i), '7')
    await user.click(screen.getByRole('button', { name: /Connect/i }))

    await waitFor(() =>
      expect(cloud.updateCloudConnection).toHaveBeenCalledWith({
        api_token: 'tok-1',
        sandbox_id: 7,
        mirror_enabled: false,
      }),
    )
  })
})

// ---------------------------------------------------------------------
// RelayConnectDialog
// ---------------------------------------------------------------------

describe('RelayConnectDialog', () => {
  it('renders host / port / TLS / auth inputs in the disconnected state', async () => {
    renderWithProviders(<RelayConnectDialog open onOpenChange={vi.fn()} />)
    expect(
      await screen.findByRole('heading', { name: /SMTP Relay/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Host/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Port/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/TLS/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Auth method/i)).toBeInTheDocument()
  })

  it('clicking Configure submits host/port/auth/tls to updateRelayConnection', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RelayConnectDialog open onOpenChange={vi.fn()} />)
    await screen.findByRole('heading', { name: /SMTP Relay/i })

    await user.type(screen.getByLabelText(/Host/i), 'smtp.example.com')
    // Default port is 587 (prefilled). Click Configure straight away.
    await user.click(screen.getByRole('button', { name: /Configure/i }))

    await waitFor(() =>
      expect(relay.updateRelayConnection).toHaveBeenCalled(),
    )
    const body = relay.updateRelayConnection.mock.calls[0][0]
    expect(body).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      auth: 'plain',
      tls: 'auto',
    })
  })
})

// ---------------------------------------------------------------------
// WebhookConnectDialog
// ---------------------------------------------------------------------

describe('WebhookConnectDialog', () => {
  it('renders URL + secret inputs in the disconnected state', async () => {
    renderWithProviders(<WebhookConnectDialog open onOpenChange={vi.fn()} />)
    expect(
      await screen.findByRole('heading', { name: /Webhook/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/URL/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Secret/i)).toBeInTheDocument()
  })

  it('Configure button is disabled until URL is a valid http(s) URL', async () => {
    const user = userEvent.setup()
    renderWithProviders(<WebhookConnectDialog open onOpenChange={vi.fn()} />)
    await screen.findByRole('heading', { name: /Webhook/i })

    const save = screen.getByRole('button', { name: /Configure/i })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText(/URL/i), 'not-a-url')
    expect(save).toBeDisabled()

    // Replace contents with a real URL.
    await user.clear(screen.getByLabelText(/URL/i))
    await user.type(
      screen.getByLabelText(/URL/i),
      'https://hooks.example.com/x',
    )
    expect(save).toBeEnabled()
  })

  it('Send test calls testWebhookConnection with current URL + secret', async () => {
    const user = userEvent.setup()
    renderWithProviders(<WebhookConnectDialog open onOpenChange={vi.fn()} />)
    await screen.findByRole('heading', { name: /Webhook/i })

    await user.type(
      screen.getByLabelText(/URL/i),
      'https://hooks.example.com/x',
    )
    await user.type(screen.getByLabelText(/Secret/i), 'shh')

    await user.click(screen.getByRole('button', { name: /Send test/i }))

    await waitFor(() =>
      expect(webhook.testWebhookConnection).toHaveBeenCalledWith({
        url: 'https://hooks.example.com/x',
        secret: 'shh',
      }),
    )
  })

  it('Configure submits URL + secret to updateWebhookConnection', async () => {
    const user = userEvent.setup()
    renderWithProviders(<WebhookConnectDialog open onOpenChange={vi.fn()} />)
    await screen.findByRole('heading', { name: /Webhook/i })

    await user.type(
      screen.getByLabelText(/URL/i),
      'https://hooks.example.com/y',
    )
    await user.type(screen.getByLabelText(/Secret/i), 'top-secret-xyz')

    await user.click(screen.getByRole('button', { name: /Configure/i }))

    await waitFor(() =>
      expect(webhook.updateWebhookConnection).toHaveBeenCalled(),
    )
    expect(webhook.updateWebhookConnection.mock.calls[0][0]).toMatchObject({
      url: 'https://hooks.example.com/y',
      secret: 'top-secret-xyz',
      enabled: false,
    })
  })
})
