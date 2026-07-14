'use client'

import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

// Shared defaults for the fleet detail-page side panels (vehicle + driver),
// so the two pages stay visually identical.
export const DETAIL_PANEL_DEFAULT_W = 520
export const DETAIL_PANEL_MIN_W = 360
export const DETAIL_PANEL_MAX_W = 720

interface ResizablePanel {
  width: number
  startResize: (e: ReactMouseEvent) => void
}

/**
 * Owns a single resizable panel's width and the drag interaction. The panel
 * renders `style={{ width }}` and wires `onMouseDown={startResize}` to a drag
 * handle. Width is clamped to [min, max] during the drag.
 *
 * Scoped to single-panel detail layouts. The dashboard/history tables use a
 * different per-column resize and intentionally do not use this hook.
 */
export function useResizablePanel(
  initialWidth: number,
  opts: { min: number; max: number },
): ResizablePanel {
  const [width, setWidth] = useState(initialWidth)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)

  function startResize(e: ReactMouseEvent) {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startW: width }

    function onMove(ev: globalThis.MouseEvent) {
      const r = resizeRef.current
      if (!r) return
      const next = r.startW + (ev.clientX - r.startX)
      setWidth(Math.min(opts.max, Math.max(opts.min, next)))
    }

    function onUp() {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return { width, startResize }
}
