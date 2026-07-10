/**
 * resolveCidUrls rewrites `cid:<content-id>` references in email HTML to
 * the backend part endpoint so the preview iframe can actually load
 * inline images. Unknown content-ids must be left untouched — a broken
 * cid ref stays broken rather than pointing at a wrong part.
 */
import { describe, it, expect } from 'vitest'
import { resolveCidUrls } from './inlineImages'
import { makeAttachment } from '../test/fixtures'

const origin = window.location.origin

describe('resolveCidUrls', () => {
  it('rewrites an img src cid ref to an absolute part URL', () => {
    const html = '<img src="cid:logo@example.test" alt="logo">'
    const out = resolveCidUrls(html, 'msg-1', [
      makeAttachment({ part_id: '2', content_id: 'logo@example.test' }),
    ])
    expect(out).toBe(
      `<img src="${origin}/api/v1/message/msg-1/part/2" alt="logo">`,
    )
  })

  it('leaves cid refs without a matching part untouched', () => {
    const html = '<img src="cid:missing@example.test">'
    const out = resolveCidUrls(html, 'msg-1', [
      makeAttachment({ content_id: 'other@example.test' }),
    ])
    expect(out).toBe(html)
  })

  it('returns html unchanged when no part carries a content id', () => {
    const html = '<img src="cid:logo@example.test">'
    expect(
      resolveCidUrls(html, 'msg-1', [makeAttachment({ content_id: '' })]),
    ).toBe(html)
    expect(resolveCidUrls(html, 'msg-1', [])).toBe(html)
  })

  it('trims RFC 2045 angle brackets from the API content_id', () => {
    const out = resolveCidUrls('<img src="cid:logo@example.test">', 'msg-1', [
      makeAttachment({ part_id: '3', content_id: '<logo@example.test>' }),
    ])
    expect(out).toContain('/api/v1/message/msg-1/part/3')
  })

  it('matches percent-encoded cid refs against the raw content_id', () => {
    const out = resolveCidUrls('<img src="cid:image%20one">', 'msg-1', [
      makeAttachment({ part_id: '4', content_id: 'image one' }),
    ])
    expect(out).toContain('/api/v1/message/msg-1/part/4')
  })

  it('rewrites multiple refs including CSS url(cid:...) and CID: casing', () => {
    const html =
      '<div style="background:url(cid:bg@x)"><img src="CID:logo@x"></div>'
    const out = resolveCidUrls(html, 'msg-1', [
      makeAttachment({ part_id: '2', content_id: 'logo@x' }),
      makeAttachment({ part_id: '5', content_id: 'bg@x' }),
    ])
    expect(out).toContain(`url(${origin}/api/v1/message/msg-1/part/5)`)
    expect(out).toContain(`src="${origin}/api/v1/message/msg-1/part/2"`)
    expect(out).not.toMatch(/cid:/i)
  })

  it('does not rewrite prose that merely mentions an unknown cid:', () => {
    const html = '<p>see cid:something in the spec</p>'
    expect(resolveCidUrls(html, 'msg-1', [makeAttachment()])).toBe(html)
  })
})
