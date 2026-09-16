'use client'

import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

// Shared defaults for the fleet detail-page side panels (vehicle + driver).
export const DETAIL_PANEL_DEFAULT_W = 520
export const DETAIL_PANEL_MIN_W = 360
export const DETAIL_PANEL_MAX_W = 720

/** Which edge of the panel the drag handle sits on. */
export type ResizeEdge = 'left' | 'right'

interface ResizablePanel {
  width: number
  startResize: (e: ReactMouseEvent) => void
}

/** Clamp a width into [min, max], where MAX WINS when the two conflict: a caller on a
 *  narrow viewport can legitimately pass a max below min, and a panel wider than the
 *  space available pushes its neighbour out of an `overflow-hidden` row and clips it. */
export function clampPanelWidth(width: number, min: number, max: number): number {
  const upper = Math.max(0, max)
  return Math.min(upper, Math.max(Math.min(min, upper), width))
}

/** Width arithmetic for one drag step, extracted so the sign convention is testable
 *  without a DOM. A left-edge handle widens the panel as the pointer moves LEFT, since
 *  the panel grows backwards into the column beside it. */
export function nextPanelWidth(
  startWidth: number,
  pointerDelta: number,
  edge: ResizeEdge,
  min: number,
  max: number,
): number {
  const raw = startWidth + (edge === 'left' ? -pointerDelta : pointerDelta)
  return clampPanelWidth(raw, min, max)
}

/**
 * Owns a single resizable panel's width and the drag interaction. The panel renders
 * `style={{ width }}` and wires `onMouseDown={startResize}`. Width is clamped to
 * [min, max] during the drag AND on read. Pass the actual available space as `max`, not
 * a constant, or the panel can push a neighbour out of an `overflow-hidden` row.
 * Scoped to single-panel detail layouts; the dashboard/history tables resize per-column.
 */
export function useResizablePanel(
  initialWidth: number,
  opts: { min: number; max: number; edge?: ResizeEdge },
): ResizablePanel {
  const [width, setWidth] = useState(initialWidth)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)

  const edge = opts.edge ?? 'right'

  function startResize(e: ReactMouseEvent) {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startW: width }

    function onMove(ev: globalThis.MouseEvent) {
      const r = resizeRef.current
      if (!r) return
      setWidth(nextPanelWidth(r.startW, ev.clientX - r.startX, edge, opts.min, opts.max))
    }

    function onUp() {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Clamped on read too: `max` shrinks with the window, and state alone would keep
  // overflowing until the user dragged it back by hand.
  return { width: clampPanelWidth(width, opts.min, opts.max), startResize }
}
