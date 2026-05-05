import { useCallback, useEffect, useRef } from 'react'
import { useMessagesChannel } from './useMessagesChannel'

const FAVICON_LINK_ID = 'mt-favicon-badge'
const BASE_FAVICON_HREF = '/favicon.svg'
const CANVAS_SIZE = 64

// While the tab is in the background, count messages that arrive over the
// messages channel and overlay a count badge on the favicon + prefix the
// document title. Reset the moment the user comes back. Driven by the live
// WebSocket so the badge appears the instant a new message lands — no
// polling loop.
export function useUnreadFaviconBadge() {
  const countRef = useRef(0)
  const baseImageRef = useRef<HTMLImageElement | null>(null)
  const originalTitleRef = useRef<string>(document.title)

  const renderBadge = useCallback(() => {
    const n = countRef.current
    if (n > 0) {
      paintBadge(baseImageRef.current, n)
      document.title = `(${formatBadgeCount(n)}) ${originalTitleRef.current}`
    } else {
      removeBadgeFavicon()
      document.title = originalTitleRef.current
    }
  }, [])

  // Increment only while the tab is hidden. The badge represents "new
  // arrivals since you looked away", so foreground broadcasts shouldn't
  // touch it — they'll already be visible in the sidebar list.
  const onCreated = useCallback(() => {
    if (!document.hidden) return
    countRef.current += 1
    renderBadge()
  }, [renderBadge])

  useMessagesChannel({ onCreated })

  // Pre-decode the base favicon once so the canvas paint is synchronous on
  // each render. Also wire visibilitychange to reset on focus return.
  useEffect(() => {
    let disposed = false

    const img = new Image()
    img.src = BASE_FAVICON_HREF
    img
      .decode()
      .then(() => {
        if (!disposed) baseImageRef.current = img
      })
      .catch(() => {})

    const onVisibilityChange = () => {
      if (!document.hidden) {
        countRef.current = 0
        renderBadge()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      countRef.current = 0
      renderBadge()
    }
  }, [renderBadge])
}

function formatBadgeCount(n: number): string {
  return n > 9 ? '9+' : String(n)
}

function paintBadge(baseImg: HTMLImageElement | null, count: number) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_SIZE
  canvas.height = CANVAS_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  if (baseImg && baseImg.complete && baseImg.naturalWidth > 0) {
    ctx.drawImage(baseImg, 0, 0, CANVAS_SIZE, CANVAS_SIZE)
  } else {
    ctx.fillStyle = '#22d172'
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  }

  const label = formatBadgeCount(count)
  const r = label.length > 1 ? 22 : 20
  const cx = CANVAS_SIZE - r + 2
  const cy = r - 2

  ctx.fillStyle = '#dc2626'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${label.length > 1 ? 24 : 28}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, cx, cy + 1)

  setBadgeFavicon(canvas.toDataURL('image/png'))
}

function setBadgeFavicon(href: string) {
  let link = document.getElementById(FAVICON_LINK_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = FAVICON_LINK_ID
    link.rel = 'icon'
    link.type = 'image/png'
    document.head.appendChild(link)
  }
  link.href = href
}

function removeBadgeFavicon() {
  const link = document.getElementById(FAVICON_LINK_ID)
  if (link) link.remove()
}
