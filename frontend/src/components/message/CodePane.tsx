import { type ReactNode } from 'react'
import { ExternalLinkIcon } from '../ui/icons'
import { IconButton } from '../ui/IconButton'
import { codeBlockBase } from '../../lib/styles'

// Plain-text + raw bodies. Min-height tracks the desktop iframe so short
// payloads still fill the viewport.
const preStyle = `${codeBlockBase} bg-black/20 p-3 text-fg leading-[1.5] whitespace-pre-wrap break-words`

interface Props {
  content: string
  /** Title for the pop-out button (e.g. "Open text in new tab"). */
  popoutTitle?: string
  onPopout?: () => void
  /** Replaces the body when `content` is empty. */
  fallback: ReactNode
}

export function CodePane({
  content,
  popoutTitle,
  onPopout,
  fallback,
}: Props) {
  return (
    <div>
      {onPopout && content && (
        <div className="flex justify-end pb-2">
          <IconButton variant="toolbar" title={popoutTitle} onClick={onPopout}>
            <ExternalLinkIcon size={14} />
          </IconButton>
        </div>
      )}
      <pre className={preStyle}>{content || fallback}</pre>
    </div>
  )
}
