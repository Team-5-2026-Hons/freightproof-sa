// frontend/driver-pwa/components/ui/QrCode.tsx
//
// Renders a payload as a QR on a canvas (FP-238).
//
// Error-correction level H, the highest available, costing about 30% more modules for the
// same data. That trade is correct here and nowhere else in the app: this code is read
// across a warehouse, off a screen that may be scratched, greasy, dimmed by a battery
// saver, or held at an angle, by a phone camera nobody configured. A QR that needs two
// attempts costs the driver a conversation he should not have to have.
'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { QR_CANVAS_COLOURS } from '@/lib/tokens'

interface QrCodeProps {
  /** The URL to encode. Null renders the placeholder rather than an empty canvas. */
  value: string | null
  /**
   * Largest CSS width the code may occupy. It is a CEILING, not a fixed size: the square
   * shrinks with the viewport so a narrow handset never gets a horizontally scrolling
   * page, which is what happens the moment this renders wider than the screen.
   */
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
      // Pure black on pure white, never the theme tokens — see QR_CANVAS_COLOURS. This
      // is the one surface in the app that must ignore dark mode outright.
      color: QR_CANVAS_COLOURS,
    })
      .then(() => {
        if (cancelled) return
        // REQUIRED, not belt-and-braces. qrcode's toCanvas writes canvas.style.width and
        // .height itself, from the `width` option above — which is the RETINA pixel count.
        // Left alone it renders the code at 2x its intended CSS size, overflowing a phone
        // screen edge to edge and giving the whole step a horizontal scrollbar. React's
        // inline style cannot win this: the library writes the style attribute after the
        // commit. So the size is reasserted here, once the library has finished with it.
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        setFailed(false)
      })
      .catch((err: unknown) => {
        // Rendering can fail if the payload exceeds QR capacity. The step has to say so
        // rather than show a blank white square the receiver will keep trying to scan.
        console.error('[qr] could not render the handover code:', err)
        if (!cancelled) setFailed(true)
      })

    return () => { cancelled = true }
  }, [value, maxSizePx])

  // One square box owns the geometry in both states, so the layout does not shift when a
  // code arrives or fails. aspect-square with a max-width keeps it square at every width
  // without either dimension being hard-coded in pixels.
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
