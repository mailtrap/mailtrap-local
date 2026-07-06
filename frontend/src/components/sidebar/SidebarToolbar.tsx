import { useRef, useState, type ChangeEvent } from 'react'
import {
  ClearSandboxIcon,
  CloseIcon,
  CloudIcon,
  MarkReadIcon,
  ReloadIcon,
  RelayIcon,
  SearchIcon,
} from '../ui/icons'
import { IconButton } from '../ui/IconButton'
import { inputBase } from '../../lib/styles'
import type { CloudConnection } from '../../api/cloud'
import type { RelayConnection } from '../../api/relay'

// data-on drives the colour: green if connected, muted if not.
const statusBadge = [
  'pointer-events-none absolute right-px bottom-px',
  'inline-flex h-2.5 w-2.5 items-center justify-center rounded-full',
  'border-2 border-surface-base text-[9px] font-bold leading-none text-fg',
  'data-[on=true]:bg-success data-[on=false]:bg-fg-muted',
].join(' ')

// data-expanded drives the "cover the icon row" mode on focus.
// `flex items-center` centers the input vertically so the absolutely-
// positioned clear-× (anchored to top: 50% of this wrapper) lines up
// with the input's vertical center when the wrapper grows taller than
// the input (expanded mode).
const searchWrap = [
  'group relative flex items-center',
  'data-[expanded=true]:absolute data-[expanded=true]:left-3 data-[expanded=true]:right-3',
  'data-[expanded=true]:top-3 data-[expanded=true]:bottom-3 data-[expanded=true]:z-[2]',
].join(' ')

const searchInput = [
  inputBase,
  'w-full py-1.5 pl-2.5 pr-8 text-sm',
  'group-data-[expanded=true]:pr-9',
].join(' ')

interface Props {
  query: string
  onQueryChange: (v: string) => void
  cloudState: CloudConnection | null
  relayState: RelayConnection | null
  onOpenCloud: () => void
  onOpenRelay: () => void
  onMarkAllRead: () => void
  onRefresh: () => void
  onCleanAll: () => void
}

export function SidebarToolbar({
  query,
  onQueryChange,
  cloudState,
  relayState,
  onOpenCloud,
  onOpenRelay,
  onMarkAllRead,
  onRefresh,
  onCleanAll,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isConnected = cloudState?.connected === true
  const isRelayConfigured = relayState?.connected === true

  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    onQueryChange(e.target.value)
  const onClose = () => {
    onQueryChange('')
    setExpanded(false)
    inputRef.current?.blur()
  }

  return (
    <div className="relative grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-1.5 min-h-[58px] border-b border-border-base p-3">
      <div className={searchWrap} data-expanded={expanded}>
        <SearchIcon
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg group-data-[expanded=true]:hidden"
          size={14}
        />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search…"
          className={searchInput}
          value={query}
          onFocus={() => setExpanded(true)}
          onChange={onChange}
        />
        {expanded && (
          <button
            type="button"
            title="Close search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-fg-icon hover:bg-accent-soft hover:text-fg"
            onClick={onClose}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      <IconButton
        variant="toolbar"
        title={
          isConnected
            ? `Connected to sandbox ${cloudState?.sandbox_id}${
                cloudState?.mirror_enabled ? ' · mirroring' : ''
              }`
            : 'Connect to Mailtrap cloud sandbox'
        }
        onClick={onOpenCloud}
      >
        <CloudIcon size={16} />
        <span className={statusBadge} data-on={isConnected}>
          {isConnected ? '' : '×'}
        </span>
      </IconButton>
      <IconButton
        variant="toolbar"
        title={
          isRelayConfigured
            ? `SMTP relay → ${relayState?.host}:${relayState?.port}${
                relayState?.auto_relay_enabled ? ' · auto-relay' : ''
              }`
            : 'Configure SMTP relay'
        }
        onClick={onOpenRelay}
      >
        <RelayIcon size={16} />
        <span className={statusBadge} data-on={isRelayConfigured}>
          {isRelayConfigured ? '' : '×'}
        </span>
      </IconButton>
      <IconButton variant="toolbar" title="Mark all as read" onClick={onMarkAllRead}>
        <MarkReadIcon size={16} />
      </IconButton>
      <IconButton variant="toolbar" title="Refresh" onClick={onRefresh}>
        <ReloadIcon size={16} />
      </IconButton>
      <IconButton variant="toolbar" title="Delete all messages" onClick={onCleanAll}>
        <ClearSandboxIcon size={16} />
      </IconButton>
    </div>
  )
}
