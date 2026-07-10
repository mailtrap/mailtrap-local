import { partUrl, type AttachmentSummary } from '../../api/messages'
import {
  DownloadIcon,
  FileArchiveIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
} from '../ui/icons'
import { formatSize } from '../../lib/messageFormatters'

interface Props {
  messageId: string
  attachments: AttachmentSummary[]
}

const heading =
  'mb-1.5 m-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg'

// The whole chip is the download link; the trailing arrow lights up on
// hover/focus to signal it.
const chip = [
  'group flex items-center gap-2.5 rounded-lg border border-border-base bg-surface-raised',
  'px-3 py-2 outline-none',
  'hover:border-border-subtle hover:bg-surface-hover',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-ring',
].join(' ')

function fileTypeIcon({ content_type, file_name }: AttachmentSummary) {
  const type = content_type.toLowerCase()
  const name = file_name.toLowerCase()
  if (
    type.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(name)
  ) {
    return FileImageIcon
  }
  if (
    /\b(zip|gzip|tar|7z|rar|compressed)\b/.test(type) ||
    /\.(zip|tar|gz|tgz|rar|7z)$/.test(name)
  ) {
    return FileArchiveIcon
  }
  if (
    type.startsWith('text/') ||
    /pdf|msword|wordprocessingml|rtf|spreadsheet|presentation/.test(type) ||
    /\.(pdf|docx?|txt|md|rtf|csv|xlsx?|pptx?)$/.test(name)
  ) {
    return FileTextIcon
  }
  return FileIcon
}

export function Attachments({ messageId, attachments }: Props) {
  if (attachments.length === 0) return null

  return (
    <section className="mt-4">
      <h3 className={heading}>
        Attachments <span className="text-fg-muted">({attachments.length})</span>
      </h3>
      <ul className="flex flex-wrap gap-2">
        {attachments.map((a) => {
          const TypeIcon = fileTypeIcon(a)
          const name = a.file_name || '(unnamed)'
          return (
            <li key={a.part_id}>
              <a
                href={partUrl(messageId, a.part_id)}
                download={a.file_name || undefined}
                className={chip}
                title={`Download ${name}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-medium text-accent">
                  <TypeIcon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[200px] truncate text-[13px] font-medium text-fg">
                    {name}
                  </span>
                  <span className="block text-[12px] text-fg-muted">
                    {formatSize(a.size)}
                  </span>
                </span>
                <DownloadIcon
                  size={14}
                  className="ml-1 shrink-0 text-fg-muted group-hover:text-accent group-focus-visible:text-accent"
                />
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
