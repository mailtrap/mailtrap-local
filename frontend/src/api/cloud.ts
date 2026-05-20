import { api } from './client'

/**
 * Mirrors the server-side Api::V1::CloudConnectionsController payload.
 * The raw token is never returned — `api_token_hint` shows only the last
 * 4 chars so the UI can confirm which token is saved without leaking it.
 */
export type CloudConfigKey = 'api_token' | 'sandbox_id' | 'mirror_enabled'

export interface CloudConnection {
  connected: boolean
  sandbox_id: number | null
  mirror_enabled: boolean
  /**
   * `"from config"` when the token is supplied via YAML overlay, "••••XXXX"
   * when stored in the DB, null when unset.
   */
  api_token_hint: string | null
  /** Per-field lock state. See RelayConnection.locked for semantics. */
  locked: Record<CloudConfigKey, boolean>
  /** Absolute path of the loaded config file, or null when none exists. */
  config_path: string | null
}

export async function getCloudConnection(
  signal?: AbortSignal,
): Promise<CloudConnection> {
  const res = await api.get<CloudConnection>('/cloud_connection', { signal })
  return res.data
}

export async function updateCloudConnection(
  body: {
    api_token?: string
    sandbox_id?: number
    mirror_enabled?: boolean
  },
  signal?: AbortSignal,
): Promise<CloudConnection> {
  const res = await api.put<CloudConnection>('/cloud_connection', body, {
    signal,
  })
  return res.data
}

export async function disconnectCloud(
  signal?: AbortSignal,
): Promise<CloudConnection> {
  const res = await api.delete<CloudConnection>('/cloud_connection', { signal })
  return res.data
}

/** One-off forward: sends a single stored message to the connected sandbox. */
export async function sendMessageToCloud(
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  await api.post(`/message/${id}/send_to_cloud`, undefined, { signal })
}

/** Parses a sandbox ID out of either a bare number or a Mailtrap URL. */
export function parseSandboxId(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const match = trimmed.match(/(\d+)(?!.*\d)/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}
