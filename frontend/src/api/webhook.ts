import { api } from './client'

/** Keys that may appear in the `locked` map. Mirrors WebhookConnection::CONFIG_KEYS. */
export type WebhookConfigKey = 'url' | 'secret' | 'enabled'

/**
 * Mirrors Api::V1::WebhookConnectionsController payload. Same locked-field
 * semantics as the relay/cloud connections — see api/relay.ts for the
 * shared rules.
 */
export interface WebhookConnection {
  connected: boolean
  url: string | null
  enabled: boolean
  /** "from config" / "••••XX" / null — never echoes the raw secret. */
  secret_hint: string | null
  locked: Record<WebhookConfigKey, boolean>
  config_path: string | null
}

export async function getWebhookConnection(): Promise<WebhookConnection> {
  const res = await api.get<WebhookConnection>('/webhook_connection')
  return res.data
}

export async function updateWebhookConnection(body: {
  url?: string
  secret?: string
  enabled?: boolean
}): Promise<WebhookConnection> {
  const res = await api.put<WebhookConnection>('/webhook_connection', body)
  return res.data
}

export async function disconnectWebhook(): Promise<WebhookConnection> {
  const res = await api.delete<WebhookConnection>('/webhook_connection')
  return res.data
}

export interface WebhookTestResult {
  ok: boolean
  message?: string
  error?: string
}

/**
 * POST /api/v1/webhook_connection/test — sends a synthetic ping payload
 * with the same signing/headers as the real delivery job so the user can
 * verify their endpoint code paths without sending a real email. Empty
 * `secret` falls back to the saved one when the URL matches.
 */
export async function testWebhookConnection(body: {
  url: string
  secret?: string
}): Promise<WebhookTestResult> {
  const res = await api.post<WebhookTestResult>('/webhook_connection/test', body)
  return res.data
}
