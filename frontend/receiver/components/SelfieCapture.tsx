// frontend/receiver/components/SelfieCapture.tsx
//
// Tier 3: the receiver has no document on them. We capture a photograph OURSELVES rather
// than sending them through the vendor.
//
// Two reasons, and both matter. It burns none of the 500-per-month free quota, so a
// document-less receiver never brings the hard stop closer for someone who does have
// theirs. And a stored photograph is ordinary personal information — it only becomes
// biometric processing under POPIA s26 when a technique is APPLIED to it, which we do not
// do here.
//
// Be honest about what this proves: a live human confirmed the delivery. Not who they are.
'use client'

import { useCallback, useRef, useState } from 'react'

interface SelfieCaptureProps {
  onCaptured: (dataUrl: string) => void
  onSkip: () => void
}

const CAPTURE_WIDTH = 640

export function SelfieCapture({ onCaptured, onSkip }: SelfieCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onerror = () => setError('That photo could not be read. Please try again.')
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => setError('That photo could not be read. Please try again.')
      img.onload = () => {
        // Downscaled before upload: a modern phone camera produces several megabytes, the
        // receiver is on mobile data in a warehouse, and nothing about this evidence needs
        // full resolution.
        const scale = Math.min(1, CAPTURE_WIDTH / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (ctx === null) {
          setError('This device cannot process the photo. You can continue without it.')
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        onCaptured(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }, [onCaptured])

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-medium text-neutral-900">Photo instead</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Without an ID document we can&apos;t verify your identity, but a photo records
          that you were here. This is optional.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      {error !== '' && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="rounded-lg bg-neutral-900 px-4 py-3.5 text-base font-medium text-white"
          onClick={() => inputRef.current?.click()}
        >
          Take a photo
        </button>
        <button
          type="button"
          className="px-4 py-3 text-sm text-neutral-500 underline"
          onClick={onSkip}
        >
          Continue without a photo
        </button>
      </div>
    </section>
  )
}
