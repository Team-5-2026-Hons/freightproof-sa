// frontend/driver-pwa/components/handshake/steps/H4EntryPhoto.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H4Evidence } from '@/lib/types/evidence-draft'

interface H4EntryPhotoProps {
  tripId: string
  draft: H4Evidence
  onUpdate: (patch: Partial<H4Evidence>) => void
  onComplete: () => void
}

export function H4EntryPhoto({ tripId, draft, onUpdate, onComplete }: H4EntryPhotoProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Destination Gate-In" stepName="Entry Photo" stepIndex={2} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the destination gate entry point.
        </p>
        <CameraCapture
          label="Destination entry photo"
          dataUrl={draft.gatePhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ gatePhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!draft.gatePhotoDataUrl} />
      </div>
    </main>
  )
}
