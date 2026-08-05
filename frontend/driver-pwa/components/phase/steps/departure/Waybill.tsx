// frontend/driver-pwa/components/phase/steps/departure/Waybill.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { CameraCapture } from '@/components/phase/CameraCapture'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

interface WaybillProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: DepartureEvidence
  onUpdate: (patch: Partial<DepartureEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function Waybill({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: WaybillProps) {
  const { uploadNow } = useArtifactUpload(tripId)

  // Upload starts the moment the photo exists, not when the driver swipes — the walk
  // between the two is dead time otherwise. The data URL is stored either way, so a
  // failed early upload just means lib/api/phases.ts uploads it at submit as before.
  function handleCapture(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ waybillPhotoDataUrl: dataUrl, waybillPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ waybillPhotoArtifactId: artifactId })
    })
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the physical waybill. This becomes the legal evidence copy.
        </p>
        <CameraCapture
          label="Waybill"
          dataUrl={draft.waybillPhotoDataUrl}
          onCapture={handleCapture}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Swipe to confirm" onConfirm={onComplete} disabled={!draft.waybillPhotoDataUrl} />
      </div>
    </main>
  )
}
