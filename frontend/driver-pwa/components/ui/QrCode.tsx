// Renders a payload as a QR on a canvas. Error-correction level H (highest,
// ~30% more modules) since this code is scanned off a warehouse screen under poor conditions.
'use client'

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { QR_CANVAS_COLOURS } from '@/lib/tokens'

interface QrCodeProps {
  value: string | null
  maxSizePx?: number
}

const DEFAULT_MAX_SIZE_PX = 260

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
      color: QR_CANVAS_COLOURS,
    })
      .then(() => {
        if (cancelled) return
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        setFailed(false)
      })
      .catch((err: unknown) => {
        console.error('[qr] could not render the handover code:', err)
        if (!cancelled) setFailed(true)
      })

    return () => { cancelled = true }
  }, [value, maxSizePx])

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
