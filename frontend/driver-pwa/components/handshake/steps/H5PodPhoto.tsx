// frontend/driver-pwa/components/handshake/steps/H5PodPhoto.tsx
// BQ2 resolved 2026-06-29: proof of delivery is a photo of the delivered cargo
// AND an on-device signature from the receiver — both required.
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { SignaturePad } from '@/components/handshake/SignaturePad'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5PodPhotoProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
}

export function H5PodPhoto({ tripId, draft, onUpdate, onComplete }: H5PodPhotoProps) {
  const hasPhoto = draft.podPhotoDataUrl !== null
  const hasSignature = Boolean(draft.podSignatureDataUrl)
  const isReady = hasPhoto && hasSignature

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Photograph POD" stepIndex={4} totalSteps={6} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the delivered cargo, then have the receiver sign to confirm delivery.
        </p>
        <CameraCapture
          label="Proof of delivery photo"
          dataUrl={draft.podPhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ podPhotoDataUrl: dataUrl })}
        />
        <SignaturePad
          label="Receiver signature"
          dataUrl={draft.podSignatureDataUrl}
          onCapture={(dataUrl) => onUpdate({ podSignatureDataUrl: dataUrl || null })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Confirm POD" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
