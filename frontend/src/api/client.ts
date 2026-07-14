import axios from 'axios'

// Dev: Vite proxies /api and /cable to the Go backend (see vite.config.ts).
// Prod: the single binary embeds the SPA and serves it on the same origin
// as the API.
//
// timeout: capped at 30s globally. Long enough to survive an actually
// slow backend (HTML check on a large message, retention scan over a
// large mailbox); short enough that a hung request doesn't pin a UI
// state forever. Per-call AbortSignal is the primary cancellation
// vector; this is the safety net.
export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

/**
 * Tests whether `e` is an aborted/cancelled request, e.g. because a
 * caller's AbortController fired during a route change. UI code uses
 * this to distinguish "should not surface the error" from a real
 * failure that deserves a toast.
 */
export function isAbortError(e: unknown): boolean {
  if (axios.isCancel(e)) return true
  if (e instanceof Error && e.name === 'CanceledError') return true
  if (e instanceof Error && e.name === 'AbortError') return true
  return false
}

/**
 * Tests whether `e` is an HTTP 404 from the backend — the resource is
 * gone (deleted by another client, the API, or retention eviction), not
 * a transport or server failure. UI code uses this to render a "was
 * deleted" empty state instead of a generic error.
 */
export function isNotFoundError(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 404
}

/**
 * Pulls a human-readable message out of whatever shape a caught error has.
 * Prefers the backend's `{error: "..."}` JSON body when present, falls back
 * to the Error#message, and finally to a String coerce.
 *
 * Returns "" for cancellation errors — callers should check isAbortError
 * before calling this and skip surfacing the message entirely.
 */
export function extractApiError(e: unknown): string {
  if (isAbortError(e)) return ''
  if (axios.isAxiosError(e)) {
    const body = e.response?.data as { error?: string } | undefined
    if (body?.error) return body.error
    return e.message
  }
  if (e instanceof Error) return e.message
  return String(e)
}
