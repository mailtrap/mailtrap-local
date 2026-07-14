/**
 * Reusable fixture factories for the frontend test suite. Each factory
 * accepts a partial override so individual tests can tweak just the
 * fields they care about without rebuilding the rest.
 */
import type {
  Address,
  AttachmentSummary,
  Message,
  MessageSummary,
} from '../api/messages'

function makeAddress(over: Partial<Address> = {}): Address {
  return { name: '', address: 'someone@example.test', ...over }
}

export function makeSummary(
  over: Partial<MessageSummary> = {},
): MessageSummary {
  return {
    id: 'msg-1',
    message_id: '<msg-1@example.test>',
    read: false,
    from: makeAddress({ address: 'sender@example.test' }),
    to: [makeAddress({ address: 'rcpt@example.test' })],
    cc: [],
    bcc: [],
    reply_to: [],
    subject: 'Hello',
    created: new Date().toISOString(),
    username: '',
    tags: [],
    size: 1024,
    attachments: 0,
    snippet: 'first line preview',
    ...over,
  }
}

export function makeAttachment(
  over: Partial<AttachmentSummary> = {},
): AttachmentSummary {
  return {
    part_id: '2',
    file_name: 'logo.png',
    content_type: 'image/png',
    content_id: 'logo@example.test',
    size: 2048,
    checksums: { md5: '', sha1: '', sha256: '' },
    ...over,
  }
}

export function makeMessage(over: Partial<Message> = {}): Message {
  const summary = makeSummary()
  return {
    id: summary.id,
    message_id: summary.message_id,
    from: summary.from,
    to: summary.to,
    cc: summary.cc,
    bcc: summary.bcc,
    reply_to: summary.reply_to,
    return_path: '',
    subject: summary.subject,
    list_unsubscribe: { header: '', links: [], errors: '', header_post: '' },
    date: summary.created,
    tags: summary.tags,
    username: summary.username,
    text: 'plain text body',
    html: '<p>html body</p>',
    size: summary.size,
    inline: [],
    attachments: [],
    envelope_from: summary.from.address,
    envelope_to: summary.to.map((a) => a.address),
    ...over,
  }
}
