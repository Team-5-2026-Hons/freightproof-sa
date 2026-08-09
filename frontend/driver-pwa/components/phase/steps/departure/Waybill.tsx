// frontend/driver-pwa/components/phase/steps/departure/Waybill.tsx
//
// Displays as "Photograph Linehaul Document" (STEP_NAMES.departure in shared/lib/
// constants/phase-meta.ts): the document handed to the driver at departure comes from a
// warehouse staff member and is the linehaul document, not the waybill.
//
// The rename is DISPLAY ONLY, deliberately. The slug stays '3-waybill' and the wire
// field stays waybill_photo_artifact_id — both are mirrored in backend/app/core/
// phase_meta.py, contract-tested by tests/unit/test_phase_meta_contract.py, and baked
// into every stored draft key and deep link already on drivers' phones. The filename
// follows the slug for the same reason.
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
        <p className="text-lg leading-relaxed text-surface-on-variant">
          Photograph the linehaul document you received from the warehouse staff member. This becomes the legal evidence copy.
        </p>
        <CameraCapture
          label="Linehaul document"
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
