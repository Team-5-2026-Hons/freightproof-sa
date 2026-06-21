// frontend/driver-pwa/components/handshake/steps/H1EntryPhoto.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H1Evidence } from '@/lib/types/evidence-draft'

interface H1EntryPhotoProps {
  tripId: string
  draft: H1Evidence
  onUpdate: (patch: Partial<H1Evidence>) => void
  onComplete: () => void
}

export function H1EntryPhoto({ tripId, draft, onUpdate, onComplete }: H1EntryPhotoProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader
        tripId={tripId}
        handshakeName="Origin Gate-In"
        stepName="Entry Photo"
        stepIndex={2}
        totalSteps={3}
      />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the gate entry point. This photo is anchored as evidence of your arrival.
        </p>
        <CameraCapture
          label="Gate entry photo"
          dataUrl={draft.gatePhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ gatePhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton
          label="Hold to confirm"
          onConfirm={onComplete}
          disabled={!draft.gatePhotoDataUrl}
        />
      </div>
    </main>
  )
}
