'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface SignaturePadProps {
  label: string
  dataUrl: string | null
  onCapture: (dataUrl: string) => void
}

// A point in normalized canvas space (0..1 relative to the CSS box). Strokes are
// stored this way — not as pixels — so a rotation, keyboard show/hide, or
// split-view resize can replay them at the new size without losing the signature.
interface NormalizedPoint {
  x: number
  y: number
}

// Canvas stroke width is a literal (Tailwind can't style canvas paint); 2.5 CSS px
// reads as pen-weight on phone screens without turning into a marker on small pads.
const STROKE_WIDTH_PX = 2.5

// Receiver signs directly on the driver's device at H5 (BQ2 resolved: POD is a
// photo AND a signature, not either/or). Pointer events cover touch, mouse, and
// stylus in one handler set — no separate touch/mouse listeners needed.
export function SignaturePad({ label, dataUrl, onCapture }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const lastPoint = useRef<NormalizedPoint | null>(null)
  // Source of truth for the signature. Assigning canvas.width/height erases the
  // bitmap, so pixels alone can't survive a resize — every stroke is kept as
  // normalized data and replayed after the backing store is re-sized.
  const strokesRef = useRef<NormalizedPoint[][]>([])

  // Backing store at devicePixelRatio so the signature isn't blurry on
  // high-DPI phone screens, while CSS size stays at the layout box. Assigning
  // width/height resets ALL context state, so the transform and stroke style are
  // re-applied here every time.
  const sizeBackingStore = useCallback((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    // A hidden/collapsed layout reports 0×0 — keep the previous bitmap rather
    // than shrinking the store to nothing; the observer fires again once visible.
    if (rect.width === 0 || rect.height === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // setTransform (not scale) so repeated resizes never compound the DPR factor;
    // with it active, all drawing below stays in CSS-pixel units.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineWidth = STROKE_WIDTH_PX
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Canvas needs a literal color, not a Tailwind class — read the design
    // system's "ink" token via its computed CSS `color` instead of a raw hex
    // (DESIGN_SYSTEM.md §2.2 forbids hardcoded hex in component code).
    ctx.strokeStyle = getComputedStyle(canvas).color
  }, [])

  // Clears the surface and replays every stored stroke scaled to the current CSS
  // box. Runs after any resize (strokes reappear at the new size) and on Clear
  // (empty store — just wipes the surface).
  const redraw = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    // The DPR transform is active, so clearing in CSS units covers the bitmap
    // exactly (backing px = CSS px × dpr on both axes).
    ctx.clearRect(0, 0, rect.width, rect.height)
    for (const stroke of strokesRef.current) {
      // Single-point strokes render nothing under stroke(); skip them.
      if (stroke.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x * rect.width, stroke[0].y * rect.height)
      for (let i = 1; i < stroke.length; i += 1) {
        ctx.lineTo(stroke[i].x * rect.width, stroke[i].y * rect.height)
      }
      ctx.stroke()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Fires once on initial observation — covering the old run-once mount sizing —
    // and again on rotation, keyboard show/hide, and split-view resizes, re-sizing
    // the backing store and replaying the stored strokes at the new geometry.
    const observer = new ResizeObserver(() => {
      sizeBackingStore(canvas)
      redraw(canvas)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [sizeBackingStore, redraw])

  const getPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): NormalizedPoint | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      // A 0×0 box has no meaningful coordinates (and would divide by zero).
      if (rect.width === 0 || rect.height === 0) return null
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      }
    },
    [],
  )

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const point = getPoint(e)
    if (!point) return
    setIsDrawing(true)
    lastPoint.current = point
    strokesRef.current.push([point])
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return
    const point = getPoint(e)
    if (!point || !lastPoint.current) return
    // Record before painting — the replay-on-resize depends on the data store
    // being complete; the pixels are just its current projection.
    strokesRef.current[strokesRef.current.length - 1]?.push(point)

    // Live incremental segment (cheaper than a full redraw per move). Points are
    // denormalized against the CURRENT box, so if a resize fired mid-stroke the
    // continuation still lands exactly under the pointer.
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      const rect = canvas.getBoundingClientRect()
      ctx.beginPath()
      ctx.moveTo(lastPoint.current.x * rect.width, lastPoint.current.y * rect.height)
      ctx.lineTo(point.x * rect.width, point.y * rect.height)
      ctx.stroke()
    }
    lastPoint.current = point
    if (!hasStrokes) setHasStrokes(true)
  }

  function handlePointerUp() {
    if (!isDrawing) return
    setIsDrawing(false)
    lastPoint.current = null
    // A tap that never moved leaves a single-point stroke that renders nothing —
    // drop it so the store always mirrors hasStrokes and the visible signature.
    const strokes = strokesRef.current
    const lastStroke = strokes[strokes.length - 1]
    if (lastStroke && lastStroke.length < 2) strokes.pop()
    const canvas = canvasRef.current
    if (canvas && hasStrokes) onCapture(canvas.toDataURL('image/png'))
  }

  function handleClear() {
    const canvas = canvasRef.current
    if (!canvas) return
    strokesRef.current = []
    lastPoint.current = null
    setIsDrawing(false)
    // Empty store, so redraw just wipes the surface (in CSS units, DPR-safe).
    redraw(canvas)
    setHasStrokes(false)
    onCapture('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        {(hasStrokes || dataUrl) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconLeft={<RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
            onClick={handleClear}
          >
            Clear
          </Button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="h-40 w-full touch-none rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low text-surface-on"
      />
      {!hasStrokes && !dataUrl && (
        <p className="text-xs text-surface-on-variant">Have the receiver sign above.</p>
      )}
    </div>
  )
}
