// frontend/driver-pwa/components/phase/steps/confirmation/PodPhoto.tsx
// BQ2 resolved 2026-06-29: proof of delivery is a photo of the delivered cargo
// AND an on-device signature from the receiver — both required, now captured as two
// separate steps (this one, and PodSignature.tsx) instead of one combined screen, per
// confirmation's recipe (STEP_SLUGS.confirmation: '1-pod-photo', '2-pod-signature').
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
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
  const { uploadNow } = useArtifactUpload(tripId)

  // Upload starts the moment the photo exists, not when the driver swipes — the walk
  // between the two is dead time otherwise. The data URL is stored either way, so a
  // failed early upload just means lib/api/phases.ts uploads it at submit as before.
  function handleCapture(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ podPhotoDataUrl: dataUrl, podPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ podPhotoArtifactId: artifactId })
    })
  }

  const hasPhoto = draft.podPhotoDataUrl !== null

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-lg leading-relaxed text-surface-on-variant">
          Photograph the delivered cargo.
        </p>
        <CameraCapture
          label="Proof of delivery photo"
          dataUrl={draft.podPhotoDataUrl}
          onCapture={handleCapture}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Swipe to confirm" onConfirm={onComplete} disabled={!hasPhoto} />
      </div>
    </main>
  )
}
