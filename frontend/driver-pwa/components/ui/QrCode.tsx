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
  /** Rendered size in CSS pixels. The canvas is drawn at 2x for retina sharpness. */
  size?: number
}

const DEFAULT_SIZE = 260
const RETINA_SCALE = 2

export function QrCode({ value, size = DEFAULT_SIZE }: QrCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || value === null) return

    let cancelled = false
    QRCode.toCanvas(canvas, value, {
      width: size * RETINA_SCALE,
      margin: 2,
      errorCorrectionLevel: 'H',
      // Pure black on pure white, never the theme tokens — see QR_CANVAS_COLOURS. This
      // is the one surface in the app that must ignore dark mode outright.
      color: QR_CANVAS_COLOURS,
    })
      .then(() => { if (!cancelled) setFailed(false) })
      .catch((err: unknown) => {
        // Rendering can fail if the payload exceeds QR capacity. The step has to say so
        // rather than show a blank white square the receiver will keep trying to scan.
        console.error('[qr] could not render the handover code:', err)
        if (!cancelled) setFailed(true)
      })

    return () => { cancelled = true }
  }, [value, size])

  if (value === null || failed) {
    return (
      <div
        className="flex animate-pulse items-center justify-center rounded-xl bg-surface-container-high"
        style={{ width: size, height: size }}
        role="status"
        aria-label={failed ? 'Code unavailable' : 'Generating code'}
      />
    )
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      className="rounded-xl bg-white"
      aria-label="Delivery confirmation QR code"
    />
  )
}
