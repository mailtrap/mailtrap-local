import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openInNewTab } from './openInNewTab'

// jsdom doesn't implement object URLs; capture the Blob we'd open so we
// can inspect what would be rendered in the new tab.
let lastBlob: Blob | null = null

beforeEach(() => {
  lastBlob = null
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = (
    b: Blob,
  ) => {
    lastBlob = b
    return 'blob:mock'
  }
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {}
  vi.stubGlobal('open', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openInNewTab', () => {
  it('renders untrusted HTML inside a sandboxed iframe, never as top-level script', async () => {
    openInNewTab('<script>fetch("/api/v1/messages")</script>', 'text/html')

    expect(lastBlob).toBeTruthy()
    expect(lastBlob!.type).toContain('text/html')

    const text = await lastBlob!.text()
    const doc = new DOMParser().parseFromString(text, 'text/html')

    // The wrapper page itself carries NO executable script — the email's
    // <script> is inert inside the iframe's srcdoc attribute, not a real
    // DOM <script> element in the opened document.
    expect(doc.querySelectorAll('script').length).toBe(0)

    const iframe = doc.querySelector('iframe')
    expect(iframe).toBeTruthy()
    // sandbox with no allow-tokens = scripts + same-origin disabled.
    expect(iframe!.getAttribute('sandbox')).toBe('')
    // The email markup rides along in srcdoc (inert).
    expect(iframe!.getAttribute('srcdoc')).toContain(
      '<script>fetch("/api/v1/messages")</script>',
    )
  })

  it('escapes quotes so the email cannot break out of the srcdoc attribute', async () => {
    openInNewTab('<img src="x" onerror="alert(1)">', 'text/html')
    const text = await lastBlob!.text()
    // The raw double-quotes are entity-escaped in the serialized wrapper,
    // so they stay inside the srcdoc attribute value.
    expect(text).toContain('&quot;')
    expect(text).not.toContain('srcdoc="<img src="x"')
  })

  it('passes plain text through unchanged as text/plain', async () => {
    openInNewTab('just a plain body', 'text/plain')
    expect(lastBlob!.type).toContain('text/plain')
    expect(await lastBlob!.text()).toBe('just a plain body')
  })
})
