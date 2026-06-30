'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'

interface SignaturePadProps {
  label: string
  dataUrl: string | null
  onCapture: (dataUrl: string) => void
}

// Receiver signs directly on the driver's device at H5 (BQ2 resolved: POD is a
// photo AND a signature, not either/or). Pointer events cover touch, mouse, and
// stylus in one handler set — no separate touch/mouse listeners needed.
export function SignaturePad({ label, dataUrl, onCapture }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Backing store at devicePixelRatio so the signature isn't blurry on
    // high-DPI phone screens, while CSS size stays at the layout box.
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Canvas needs a literal color, not a Tailwind class — read the design
    // system's "ink" token via its computed CSS `color` instead of a raw hex
    // (DESIGN_SYSTEM.md §2.2 forbids hardcoded hex in component code).
    ctx.strokeStyle = getComputedStyle(canvas).color
  }, [])

  const getPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    setIsDrawing(true)
    lastPoint.current = getPoint(e)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const point = getPoint(e)
    if (!ctx || !point || !lastPoint.current) return

    ctx.beginPath()
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPoint.current = point
    if (!hasStrokes) setHasStrokes(true)
  }

  function handlePointerUp() {
    if (!isDrawing) return
    setIsDrawing(false)
    lastPoint.current = null
    const canvas = canvasRef.current
    if (canvas && hasStrokes) onCapture(canvas.toDataURL('image/png'))
  }

  function handleClear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
    onCapture('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        {(hasStrokes || dataUrl) && (
          <button
            onClick={handleClear}
            className="flex items-center gap-1 text-xs text-surface-on-variant"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Clear
          </button>
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
