import { api } from './client'

/**
 * Wire types for /api/v1/messages and /api/v1/message/:id. Field names
 * are snake_case to align with the conventions used across the rest of
 * the Mailtrap toolchain (sandbox API, Mailtrap CLI).
 */
export interface Address {
  name: string
  address: string
}

export interface AttachmentSummary {
  part_id: string
  file_name: string
  content_type: string
  content_id: string
  size: number
  checksums: {
    md5: string
    sha1: string
    sha256: string
  }
}

interface ListUnsubscribe {
  header: string
  links: string[]
  errors: string
  header_post: string
}

/** GET /api/v1/messages list item shape */
export interface MessageSummary {
  id: string
  message_id: string
  read: boolean
  from: Address
  to: Address[]
  cc: Address[]
  bcc: Address[]
  reply_to: Address[]
  subject: string
  created: string
  username: string
  tags: string[]
  size: number
  attachments: number
  snippet: string
}

/** GET /api/v1/message/:id full shape */
export interface Message {
  id: string
  message_id: string
  from: Address
  to: Address[]
  cc: Address[]
  bcc: Address[]
  reply_to: Address[]
  return_path: string
  subject: string
  list_unsubscribe: ListUnsubscribe
  date: string
  tags: string[]
  username: string
  text: string
  html: string
  size: number
  inline: AttachmentSummary[]
  attachments: AttachmentSummary[]

  // mailtrap-local-specific extensions
  envelope_from: string
  envelope_to: string[]
}

export interface MessagesResponse {
  total: number
  unread: number
  count: number
  messages_count: number
  messages_unread: number
  start: number
  tags: string[]
  messages: MessageSummary[]
}

export type HeadersMap = Record<string, string[]>

export async function getMessages(
  params: {
    start?: number
    limit?: number
    /**
     * Optional category filter. Server matches exact equality on the message's
     * stored category (read from the X-MT-Category / Category header at
     * ingest). The response's `tags` field still lists distinct categories
     * across the *unfiltered* sandbox so callers can render a picker.
     */
    category?: string
  } = {},
  signal?: AbortSignal,
): Promise<MessagesResponse> {
  const res = await api.get<MessagesResponse>('/messages', { params, signal })
  return res.data
}

/**
 * Search. Whitespace splits `query` into tokens; each token is ANDed
 * across `subject`, `from_*`, recipient addresses, snippet, and
 * text_body. Case-insensitive. Empty `query` returns an empty
 * `messages` array (use `getMessages` for unfiltered listing).
 *
 * The response shape mirrors `MessagesResponse` — `total` and
 * `messages_count` reflect the *matched* set, not the whole sandbox.
 */
export async function searchMessages(
  params: {
    query: string
    start?: number
    limit?: number
    category?: string
  },
  signal?: AbortSignal,
): Promise<MessagesResponse> {
  const res = await api.get<MessagesResponse>('/search', { params, signal })
  return res.data
}

export async function getMessage(
  id: string,
  signal?: AbortSignal,
): Promise<Message> {
  const res = await api.get<Message>(`/message/${id}`, { signal })
  return res.data
}

export async function getRawMessage(
  id: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await api.get<string>(`/message/${id}/raw`, {
    responseType: 'text',
    transformResponse: [(v) => v],
    signal,
  })
  return res.data
}

export async function getHeaders(
  id: string,
  signal?: AbortSignal,
): Promise<HeadersMap> {
  const res = await api.get<HeadersMap>(`/message/${id}/headers`, { signal })
  return res.data
}

/**
 * HTML Check report — rule-engine results.
 * - status="success": parsed; richer payload with caniemail.com client/version
 *   data and pre-computed family + market support percentages.
 * - status="no_html": message has no HTML body.
 * - status="size_limit_exceeded": HTML too big to analyze (`limit` in bytes).
 * - status="error": validator hit an unexpected error.
 */
type ClientSupport = 'yes' | 'no' | 'partial'
export type ClientCategory = 'desktop' | 'mobile' | 'web'

export interface HtmlCheckClient {
  family: string
  platform: string
  category: ClientCategory
  display_name: string
  family_group: string
  support: ClientSupport
  note_numbers?: number[]
  versions?: {
    yes?: string[]
    no?: string[]
    partial?: string[]
  }
}

export interface HtmlCheckIssue {
  rule_name: string
  url?: string
  error_lines: number[]
  clients: HtmlCheckClient[]
  numbered_notes: Record<string, string>
}

export interface HtmlCheckFamily {
  family: string
  label: string
  market_share: number
  /** Baseline overall % (all categories enabled). Frontend recomputes
   *  whenever the user toggles category filters. */
  support_percent: number
  /** Pre-computed support % per category, used to recompute `support_percent`
   *  client-side without a roundtrip. */
  support_per_category: { desktop: number; mobile: number; web: number }
  version_counts: { desktop: number; mobile: number; web: number }
}

export type HtmlCheckReport =
  | {
      status: 'success'
      market_support_percent: number
      families: HtmlCheckFamily[]
      issues: HtmlCheckIssue[]
    }
  | { status: 'no_html' }
  | { status: 'size_limit_exceeded'; limit: number }
  | { status: 'error'; msg: string }

export async function getHtmlCheck(
  id: string,
  signal?: AbortSignal,
): Promise<HtmlCheckReport> {
  const res = await api.get<HtmlCheckReport>(`/message/${id}/html_check`, {
    signal,
  })
  return res.data
}

/**
 * DELETE /api/v1/messages — bulk/single/all delete.
 *
 * Pass `{ ids: [...] }` to delete specific messages, or `{ all: true }`
 * to wipe the entire sandbox. The server rejects empty bodies + bodies
 * without either key with 422 — wiping everything has to be explicit,
 * so a malformed body never silently truncates the mailbox.
 *
 * Axios sends the body under `data` for DELETE requests.
 */
async function deleteMessages(
  body: { ids: string[] } | { all: true },
  signal?: AbortSignal,
): Promise<void> {
  await api.delete('/messages', { data: body, signal })
}

/** Convenience wrapper for deleting a single message. */
export async function deleteMessage(
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  await deleteMessages({ ids: [id] }, signal)
}

/** Convenience wrapper for wiping every message in the sandbox. */
export async function deleteAllMessages(signal?: AbortSignal): Promise<void> {
  await deleteMessages({ all: true }, signal)
}

/**
 * PUT /api/v1/messages — read/unread toggle.
 * Pass `ids` to mark specific messages, omit to mark ALL messages.
 */
async function setReadStatus(
  body: {
    read: boolean
    ids?: string[]
  },
  signal?: AbortSignal,
): Promise<void> {
  await api.put('/messages', body, { signal })
}

export async function markAllRead(signal?: AbortSignal): Promise<void> {
  await setReadStatus({ read: true }, signal)
}

/** Absolute URL to the raw .eml — inline or forced-download via ?dl=1. */
export function rawMessageUrl(id: string, download = false): string {
  return `/api/v1/message/${id}/raw${download ? '?dl=1' : ''}`
}

/** URL to a single message part (attachment or inline) — bytes with the
 *  original Content-Type. Browsers honour Content-Disposition: attachment
 *  from the backend (download by default for attachments). */
export function partUrl(id: string, partId: string): string {
  return `/api/v1/message/${id}/part/${partId}`
}

// Per-message relay forward lives in `api/relay.ts` (releaseMessage) — kept
// near the relay connection it depends on, not here.
