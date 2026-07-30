#!/usr/bin/env node
/**
 * Send one message over SMTP (via curl) and assert it appears in GET /api/v1/messages.
 *
 * Env (required):
 *   HTTP_BASE  — e.g. http://127.0.0.1:13550
 *   SMTP_URL   — e.g. smtp://127.0.0.1:13535
 *
 * Env (optional):
 *   SUBJECT    — unique subject (default: ci-smtp-smoke-<random>-<epoch>)
 *   FROM       — envelope/header From (default: from@example.com)
 *   TO         — envelope/header To   (default: to@example.com)
 *
 * Run: node --experimental-strip-types scripts/smoke-smtp.ts
 */
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

type MessagesResponse = {
  messages?: Array<{ subject?: string }>
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

async function waitForApi(httpBase: string): Promise<void> {
  const url = `${httpBase}/api/v1/messages`
  console.log(`[smoke-smtp] waiting for API at ${httpBase}`)
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await sleep(250)
  }
  throw new Error(`API not ready at ${url}`)
}

function smtpSendViaCurl(opts: {
  smtpUrl: string
  from: string
  to: string
  subject: string
}): void {
  const { smtpUrl, from, to, subject } = opts
  console.log(`[smoke-smtp] sending via ${smtpUrl} subject=${subject}`)

  const mail =
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `\r\n` +
    `hello from smoke-smtp\r\n`

  // Same shape as the in-app curl SMTP sample (CodeSamples).
  const result = spawnSync(
    'curl',
    [
      '--silent',
      '--show-error',
      '--fail',
      '--url',
      smtpUrl,
      '--mail-from',
      from,
      '--mail-rcpt',
      to,
      '--upload-file',
      '-',
    ],
    {
      input: mail,
      encoding: 'utf8',
    },
  )

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
    throw new Error(`curl SMTP failed (exit ${result.status})${detail ? `: ${detail}` : ''}`)
  }
}

async function waitForSubject(httpBase: string, subject: string): Promise<void> {
  console.log('[smoke-smtp] waiting for message in API')
  const url = `${httpBase}/api/v1/messages`
  for (let i = 0; i < 40; i++) {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`GET ${url} failed: ${res.status}`)
    }
    const data = (await res.json()) as MessagesResponse
    if (data.messages?.some((m) => m.subject === subject)) {
      console.log(`[smoke-smtp] ok: found subject ${subject}`)
      return
    }
    await sleep(250)
  }
  const dump = await fetch(url)
    .then((r) => r.text())
    .catch(() => '')
  throw new Error(`subject not found: ${subject}\n${dump}`)
}

async function main(): Promise<void> {
  const httpBase = requireEnv('HTTP_BASE').replace(/\/$/, '')
  const smtpUrl = requireEnv('SMTP_URL')
  const subject =
    process.env.SUBJECT ?? `ci-smtp-smoke-${Math.floor(Math.random() * 1e9)}-${Date.now()}`
  const from = process.env.FROM ?? 'from@example.com'
  const to = process.env.TO ?? 'to@example.com'

  await waitForApi(httpBase)
  smtpSendViaCurl({ smtpUrl, from, to, subject })
  await waitForSubject(httpBase, subject)
}

main().catch((err: unknown) => {
  console.error('[smoke-smtp] error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
