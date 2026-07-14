// frontend/driver-pwa/components/handshake/steps/H5SealInspection.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5SealInspectionProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
}

export function H5SealInspection({ tripId, draft, onUpdate, onComplete }: H5SealInspectionProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Unloading" stepName="Wait for Inspection" stepIndex={2} totalSteps={6} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Wait for the warehouse to inspect and break the seal. Photograph the broken seal as evidence.
        </p>
        <CameraCapture
          label="Broken seal photo"
          dataUrl={draft.sealBrokenPhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ sealBrokenPhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!draft.sealBrokenPhotoDataUrl} />
      </div>
    </main>
  )
}
