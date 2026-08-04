// frontend/driver-pwa/components/phase/steps/confirmation/PodPhoto.tsx
// BQ2 resolved 2026-06-29: proof of delivery is a photo of the delivered cargo
// AND an on-device signature from the receiver — both required, now captured as two
// separate steps (this one, and PodSignature.tsx) instead of one combined screen, per
// confirmation's recipe (STEP_SLUGS.confirmation: '1-pod-photo', '2-pod-signature').
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

interface PodPhotoProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onUpdate: (patch: Partial<ConfirmationEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function PodPhoto({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: PodPhotoProps) {
  const hasPhoto = draft.podPhotoDataUrl !== null

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the delivered cargo.
        </p>
        <CameraCapture
          label="Proof of delivery photo"
          dataUrl={draft.podPhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ podPhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Swipe to confirm" onConfirm={onComplete} disabled={!hasPhoto} />
      </div>
    </main>
  )
}
