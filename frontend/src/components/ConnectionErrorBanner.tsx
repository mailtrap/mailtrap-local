import { useState } from 'react'
import { useCloudConnection } from '../hooks/useCloudConnection'
import { useRelayConnection } from '../hooks/useRelayConnection'
import { useWebhookConnection } from '../hooks/useWebhookConnection'

const bannerCss = [
  'mx-3 mt-3 mb-2 flex items-center gap-2',
  'rounded-md border border-danger-border bg-danger-soft',
  'px-3 py-2 text-xs leading-[1.4] text-danger',
].join(' ')

const messageCss = 'flex-1 min-w-0'

const retryBtnCss = [
  'shrink-0 cursor-pointer rounded border border-danger px-2 py-0.5',
  'text-[11px] font-semibold text-danger',
  'hover:bg-danger/15',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

/**
 * Inline banner shown at the top of the sidebar when one or more of
 * the three connection providers failed its initial load — i.e. the
 * `/api/v1/{cloud,relay,webhook}_connection` GET threw and the
 * provider's state never landed. Without this, the toolbar icons just
 * silently show "not configured", indistinguishable from the genuine
 * "you don't have a connection" case.
 *
 * Retry calls refresh() on each provider that's currently in the
 * error-but-no-state condition.
 */
export function ConnectionErrorBanner() {
  const cloud = useCloudConnection()
  const relay = useRelayConnection()
  const webhook = useWebhookConnection()

  const [retrying, setRetrying] = useState(false)

  // Show only when the *initial* load failed (state is still null).
  // A transient blip after a successful load keeps showing the prior
  // state with `error` set — those are surfaced by individual dialogs
  // when the user opens them, not by this banner.
  const failed = [
    { name: 'cloud sandbox', ctx: cloud, broken: cloud.error && !cloud.state },
    { name: 'SMTP relay', ctx: relay, broken: relay.error && !relay.state },
    { name: 'webhook', ctx: webhook, broken: webhook.error && !webhook.state },
  ].filter((c) => c.broken)

  if (failed.length === 0) return null

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await Promise.all(failed.map((c) => c.ctx.refresh()))
    } finally {
      setRetrying(false)
    }
  }

  const label =
    failed.length === 3
      ? "Couldn't load connections."
      : `Couldn't load ${failed.map((c) => c.name).join(', ')}.`

  return (
    <div className={bannerCss} role="alert">
      <span className={messageCss}>{label}</span>
      <button
        type="button"
        className={retryBtnCss}
        onClick={handleRetry}
        disabled={retrying}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  )
}
