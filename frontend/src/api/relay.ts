import { api } from './client'

/**
 * Mirrors the server-side relay_connection payload. The raw password is
 * never returned — `password_hint` shows only the last 2 chars when one
 * is saved.
 */
/** Keys that may appear in the `locked` map below. Mirrors the server's RelayConnection config-keys list. */
export type RelayConfigKey =
  | 'host'
  | 'port'
  | 'username'
  | 'password'
  | 'auth'
  | 'tls'
  | 'auto_relay_enabled'
  | 'override_from'
  | 'return_path'

export interface RelayConnection {
  connected: boolean
  host: string | null
  port: number
  username: string | null
  auth: 'plain' | 'login' | 'cram_md5'
  tls: 'auto' | 'ssl' | 'off'
  auto_relay_enabled: boolean
  /**
   * Optional relay-edge sender rewrites. Mirrors `override-from`
   * and `return-path` config — many providers reject relayed mail whose
   * From: domain isn't on their verified-sender list, so we let the user
   * pin a valid sender at the relay rather than at the source.
   */
  override_from: string | null
  return_path: string | null
  /**
   * Hint shown instead of the password. `"from config"` when the value
   * comes from the YAML overlay, "••••XX" when stored in the DB, null when
   * unset.
   */
  password_hint: string | null
  /**
   * Per-field lock state. `true` means the config file pins the value and
   * the dialog renders the field read-only — DB writes for it are rejected
   * with 422.
   */
  locked: Record<RelayConfigKey, boolean>
  /** Absolute path of the loaded config file, or null when none exists. */
  config_path: string | null
}

export async function getRelayConnection(): Promise<RelayConnection> {
  const res = await api.get<RelayConnection>('/relay_connection')
  return res.data
}

export async function updateRelayConnection(body: {
  host?: string
  port?: number
  username?: string
  password?: string
  auth?: RelayConnection['auth']
  tls?: RelayConnection['tls']
  auto_relay_enabled?: boolean
  /** Empty string clears the saved value; omit to leave unchanged. */
  override_from?: string
  return_path?: string
}): Promise<RelayConnection> {
  const res = await api.put<RelayConnection>('/relay_connection', body)
  return res.data
}

export async function disconnectRelay(): Promise<RelayConnection> {
  const res = await api.delete<RelayConnection>('/relay_connection')
  return res.data
}

export interface RelayTestResult {
  ok: boolean
  message?: string
  error?: string
}

/**
 * POST /api/v1/relay_connection/test — opens an SMTP session with the
 * supplied settings (HELO + STARTTLS/SSL + AUTH if creds) and closes
 * without sending. Used by the dialog to live-validate credentials.
 * Empty `password` falls back to the saved one when `username` matches.
 */
export async function testRelayConnection(body: {
  host: string
  port: number
  username?: string
  password?: string
  auth?: RelayConnection['auth']
  tls?: RelayConnection['tls']
}): Promise<RelayTestResult> {
  const res = await api.post<RelayTestResult>('/relay_connection/test', body)
  return res.data
}

/**
 * POST /api/v1/message/:id/release — per-message
 * forward. Delivers the stored message (with rewritten To:) via the
 * configured relay's SMTP settings.
 */
export async function releaseMessage(
  id: string,
  to: string[],
): Promise<void> {
  await api.post(`/message/${id}/release`, { to })
}
