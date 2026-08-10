'use client'

import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

// Shared defaults for the fleet detail-page side panels (vehicle + driver),
// so the two pages stay visually identical.
export const DETAIL_PANEL_DEFAULT_W = 520
export const DETAIL_PANEL_MIN_W = 360
export const DETAIL_PANEL_MAX_W = 720

/** Which edge of the panel the drag handle sits on. */
export type ResizeEdge = 'left' | 'right'

interface ResizablePanel {
  width: number
  startResize: (e: ReactMouseEvent) => void
}

/**
 * Clamp a width into [min, max], where MAX WINS when the two conflict.
 *
 * `max` is the space genuinely left over once every other column has taken its due, so a
 * caller on a narrow viewport can legitimately pass a max below `min`. The design minimum
 * gives way there: a cramped panel is a cosmetic problem, whereas one wider than the
 * space available pushes its neighbour out of an `overflow-hidden` row and silently clips
 * it — which is a column of the UI disappearing, not a cosmetic problem.
 */
export function clampPanelWidth(width: number, min: number, max: number): number {
  const upper = Math.max(0, max)
  return Math.min(upper, Math.max(Math.min(min, upper), width))
}

/**
 * Width arithmetic for one drag step. Extracted from the interaction so the sign
 * convention is provable without a DOM — it is the part that was actually wrong.
 *
 * A handle on the panel's RIGHT edge widens the panel as the pointer moves right. A
 * handle on its LEFT edge widens it as the pointer moves LEFT, because the panel grows
 * backwards into the column beside it. Applying the right-edge sign to a left-edge
 * handle makes the panel track the cursor in the opposite direction.
 */
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
 * Owns a single resizable panel's width and the drag interaction. The panel
 * renders `style={{ width }}` and wires `onMouseDown={startResize}` to a drag
 * handle. Width is clamped to [min, max] during the drag AND on read.
 *
 * `max` is expected to be dynamic where the panel shares a row with columns that have
 * their own minimums — pass the space actually available, not a constant, or the panel
 * will grow until it pushes a neighbour out of an `overflow-hidden` row.
 *
 * Scoped to single-panel detail layouts. The dashboard/history tables use a
 * different per-column resize and intentionally do not use this hook.
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

  // Clamped on read, not only during the drag: `max` shrinks when the window does, and a
  // width stored at a wider viewport would otherwise keep overflowing the row until the
  // user happened to drag it back by hand. State keeps the user's intent; the render
  // shows what currently fits.
  return { width: clampPanelWidth(width, opts.min, opts.max), startResize }
}
