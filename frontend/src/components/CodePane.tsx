import { type ReactNode } from 'react'
import { ExternalLinkIcon } from './icons'
import { IconButton } from './IconButton'

// Plain-text + raw bodies. Min-height tracks the desktop iframe so short
// payloads still fill the viewport.
const preStyle = [
  'rounded-[7px] border border-border-base bg-black/20 p-3 text-fg',
  'font-mono text-xs leading-[1.5]',
  'whitespace-pre-wrap break-words',
  'min-h-[max(500px,calc(100vh-260px))] [box-sizing:border-box]',
].join(' ')

interface Props {
  content: string
  /** Title for the pop-out button (e.g. "Open text in new tab"). */
  popoutTitle?: string
  onPopout?: () => void
  /** Replaces the body when `content` is empty. */
  fallback: ReactNode
}

export default function CodePane({
  content,
  popoutTitle,
  onPopout,
  fallback,
}: Props) {
  return (
    <div className="relative">
      {onPopout && content && (
        <IconButton
          variant="toolbar"
          className="absolute top-0 right-0"
          title={popoutTitle}
          onClick={onPopout}
        >
          <ExternalLinkIcon size={14} />
        </IconButton>
      )}
      <pre className={preStyle}>{content || fallback}</pre>
    </div>
  )
}
