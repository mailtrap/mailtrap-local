import { afterEach, describe, expect, it, vi } from 'vitest'
import { smtpAddress, smtpHost } from './smtpHost'

describe('smtpHost', () => {
  it('returns the hostname the UI was opened with', () => {
    expect(smtpHost('localhost')).toBe('localhost')
    expect(smtpHost('127.0.0.1')).toBe('127.0.0.1')
  })

  it('strips brackets from IPv6 literals', () => {
    expect(smtpHost('[::1]')).toBe('::1')
  })

  it('falls back to 127.0.0.1 when the hostname is empty', () => {
    expect(smtpHost('')).toBe('127.0.0.1')
  })
})

describe('smtpHost default hostname', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the page hostname when called without an argument', () => {
    vi.stubGlobal('location', { hostname: 'mailtrap.test' })
    expect(smtpHost()).toBe('mailtrap.test')
  })

  it('strips brackets from an IPv6 page hostname', () => {
    vi.stubGlobal('location', { hostname: '[::1]' })
    expect(smtpHost()).toBe('::1')
  })
})

describe('smtpAddress', () => {
  it('joins host and port', () => {
    expect(smtpAddress('localhost', 3535)).toBe('localhost:3535')
  })

  it('brackets IPv6 literals', () => {
    expect(smtpAddress('::1', 3535)).toBe('[::1]:3535')
  })
})
