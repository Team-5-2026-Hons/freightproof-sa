// Renders a payload as a QR on a canvas (FP-238). Error-correction level H (highest,
// ~30% more modules) since this code is scanned off a warehouse screen under poor conditions.
'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { QR_CANVAS_COLOURS } from '@/lib/tokens'

interface QrCodeProps {
  /** The URL to encode. Null renders the placeholder rather than an empty canvas. */
  value: string | null
  /** Largest CSS width the code may occupy — a ceiling, not a fixed size. */
  maxSizePx?: number
}

const DEFAULT_MAX_SIZE_PX = 260

// Backing-store multiplier. The canvas is DRAWN at this many device pixels per CSS pixel
// so the modules stay crisp on a retina screen; CSS then scales it back down.
const RETINA_SCALE = 2

export function QrCode({ value, maxSizePx = DEFAULT_MAX_SIZE_PX }: QrCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || value === null) return

    let cancelled = false
    QRCode.toCanvas(canvas, value, {
      width: maxSizePx * RETINA_SCALE,
      margin: 2,
      errorCorrectionLevel: 'H',
      // Pure black on pure white — the one surface that must ignore dark mode outright.
      color: QR_CANVAS_COLOURS,
    })
      .then(() => {
        if (cancelled) return
        // Required: qrcode's toCanvas writes canvas.style.width/.height itself from the
        // retina pixel count, overflowing the screen at 2x. React's inline style can't
        // win since the library writes after commit, so it's reasserted here.
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        setFailed(false)
      })
      .catch((err: unknown) => {
        // Can fail if the payload exceeds QR capacity — must say so, not show a blank square.
        console.error('[qr] could not render the handover code:', err)
        if (!cancelled) setFailed(true)
      })

    return () => { cancelled = true }
  }, [value, maxSizePx])

  // One square box owns the geometry in both states so layout doesn't shift on arrival/failure.
  const boxClassName = 'aspect-square w-full'
  const boxStyle = { maxWidth: maxSizePx }

  if (value === null || failed) {
    return (
      <div
        className={`${boxClassName} animate-pulse rounded-xl bg-surface-container-high`}
        style={boxStyle}
        role="status"
        aria-label={failed ? 'Code unavailable' : 'Generating code'}
      />
    )
  }

  return (
    <div className={boxClassName} style={boxStyle}>
      <canvas
        ref={canvasRef}
        className="block h-full w-full rounded-lg"
        aria-label="Delivery confirmation QR code"
      />
    </div>
  )
}
