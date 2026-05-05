import axios from 'axios'

// Dev: Vite proxies /api and /cable to the Go backend (see vite.config.ts).
// Prod: the single binary embeds the SPA and serves it on the same origin
// as the API.
export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

/**
 * Pulls a human-readable message out of whatever shape a caught error has.
 * Prefers the backend's `{error: "..."}` JSON body when present, falls back
 * to the Error#message, and finally to a String coerce.
 */
export function extractApiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const body = e.response?.data as { error?: string } | undefined
    if (body?.error) return body.error
    return e.message
  }
  if (e instanceof Error) return e.message
  return String(e)
}
