import { partUrl, type AttachmentSummary } from '../../api/messages'
import { DownloadIcon } from '../ui/icons'
import { formatSize } from '../../lib/messageFormatters'
import Panel from '../ui/Panel'

interface Props {
  messageId: string
  attachments: AttachmentSummary[]
}

const wrapper = 'mt-4'

const heading =
  'mb-1.5 m-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg'

const list = '[&>li:last-child]:border-b-0'

const row = [
  'flex items-center gap-3 border-b border-border-base px-3.5 py-2',
  'text-[13px] text-fg',
].join(' ')

const filename = 'flex-1 min-w-0 truncate font-medium'
const meta = 'whitespace-nowrap text-fg-muted'

const downloadLink = [
  'inline-flex items-center gap-1 rounded-md px-2 py-1',
  'text-[12px] font-medium text-accent hover:bg-accent-soft',
].join(' ')

export default function Attachments({ messageId, attachments }: Props) {
  if (attachments.length === 0) return null

  return (
    <section className={wrapper}>
      <h3 className={heading}>
        Attachments <span className="text-fg-muted">({attachments.length})</span>
      </h3>
      <Panel>
        <ul className={list}>
          {attachments.map((a) => (
            <li key={a.part_id} className={row}>
              <span className={filename} title={a.file_name}>
                {a.file_name || '(unnamed)'}
              </span>
              <span className={meta}>{a.content_type || 'application/octet-stream'}</span>
              <span className={meta}>{formatSize(a.size)}</span>
              <a
                href={partUrl(messageId, a.part_id)}
                download={a.file_name || undefined}
                className={downloadLink}
                title="Download"
              >
                <DownloadIcon size={14} />
                Download
              </a>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  )
}
