import { describe, it, expect } from 'vitest'
import { AxiosError } from 'axios'
import { extractApiError } from './client'

/**
 * extractApiError is the only place across the SPA that decides what
 * sentence to show the user when an API call blows up. The actual API
 * server returns either:
 *
 *   - a JSON envelope `{ "error": "<message>" }`  (the common case)
 *   - a plain string in the body                  (rare, but happens
 *     when middleware short-circuits)
 *   - nothing at all (network refused before the response landed)
 *
 * Plus there's the synthetic `Error` thrown by application code outside
 * axios. extractApiError has to peel through all four to a sensible
 * single-line string. These tests pin the contract.
 */
describe('extractApiError', () => {
  it('prefers the JSON {error} envelope on AxiosError', () => {
    const ax = new AxiosError(
      'Request failed with status code 422',
      'ERR_BAD_REQUEST',
    )
    // @ts-expect-error — AxiosError.response is loosely typed in the lib.
    ax.response = { status: 422, data: { error: 'host is required' } }
    expect(extractApiError(ax)).toBe('host is required')
  })

  it('falls back to AxiosError#message when the body is not the {error} envelope', () => {
    const ax = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE')
    // Plain-string body — not wrapped in `{error: …}`. We currently
    // surface the AxiosError#message rather than the body itself; the
    // test pins that contract so future changes are intentional.
    // @ts-expect-error — AxiosError.response is loosely typed.
    ax.response = { status: 500, data: 'upstream timeout' }
    expect(extractApiError(ax)).toBe('Request failed with status code 500')
  })

  it('falls back to AxiosError#message when the response has no body', () => {
    const ax = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(extractApiError(ax)).toBe('Network Error')
  })

  it('extracts message from a plain Error', () => {
    expect(extractApiError(new Error('something blew up'))).toBe(
      'something blew up',
    )
  })

  it('coerces unexpected shapes to a string', () => {
    expect(extractApiError('a raw string')).toBe('a raw string')
    expect(extractApiError({ weird: 'shape' })).toBeTypeOf('string')
    expect(extractApiError(null)).toBeTypeOf('string')
    expect(extractApiError(undefined)).toBeTypeOf('string')
  })
})
