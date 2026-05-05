import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'mt-local:sidebar-width'
export const MIN_SIDEBAR_WIDTH = 350
export const MAX_SIDEBAR_WIDTH = 720
const DEFAULT_SIDEBAR_WIDTH = 360

function clamp(n: number) {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, n))
}

export function useResizableSidebar() {
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY))
      return Number.isFinite(saved) && saved > 0 ? clamp(saved) : DEFAULT_SIDEBAR_WIDTH
    } catch {
      return DEFAULT_SIDEBAR_WIDTH
    }
  })
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(width)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    startXRef.current = e.clientX
    startWidthRef.current = width
    setDragging(true)
  }, [width])

  useEffect(() => {
    if (!dragging) return

    const onMove = (e: PointerEvent) => {
      const next = clamp(startWidthRef.current + (e.clientX - startXRef.current))
      setWidth(next)
    }
    const onUp = () => {
      setDragging(false)
      try { localStorage.setItem(STORAGE_KEY, String(startWidthRef.current)) } catch { /* ignore */ }
    }
    // Capture so we keep tracking even if the cursor leaves the handle
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging])

  // Persist the latest width whenever a drag ends — startWidthRef captured the
  // pre-drag value, so save the live width here too in case of unexpected exits.
  useEffect(() => {
    if (dragging) return
    try { localStorage.setItem(STORAGE_KEY, String(width)) } catch { /* ignore */ }
  }, [dragging, width])

  return { width, dragging, onPointerDown }
}
