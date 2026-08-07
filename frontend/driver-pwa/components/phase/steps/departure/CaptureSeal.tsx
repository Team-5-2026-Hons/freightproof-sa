// frontend/driver-pwa/components/phase/steps/departure/CaptureSeal.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { SealInput } from '@/components/phase/SealInput'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { isValidSealFormat } from '@/lib/utils/seal-format'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

interface CaptureSealProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: DepartureEvidence
  onUpdate: (patch: Partial<DepartureEvidence>) => void
  onComplete: () => void | Promise<void>
}

// The driver's own capture, and nothing else. This step used to carry a second input
// asking the gate guard to independently re-type the seal number, plus a three-way
// match/mismatch/indeterminate indicator built on sealsMatch(). All of it is gone
// (2026-08-05).
//
// Why, in one line: guards have no accounts and never will (domain rules), so "the
// guard confirmed it" was only ever the driver handing over their own phone. A number
// re-typed on the driver's device proves nothing the photograph of the physical seal
// does not already prove — and the backend's mismatch branch it fed
// (advance_departure) is now tri-state, so its absence records as "not collected"
// rather than as an anomaly.
export function CaptureSeal({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: CaptureSealProps) {
  const { uploadNow } = useArtifactUpload(tripId)
  const sealNumber = draft.sealNumber ?? ''
  // The backend 422s any seal not matching XX-#### at submit (departure's last step) —
  // validate here, where the driver can still fix it.
  const sealFormatValid = isValidSealFormat(sealNumber)
  const showSealFormatHint = sealNumber.trim().length > 0 && !sealFormatValid

  // Upload starts at capture, not at submit — see lib/hooks/useArtifactUpload.ts. The
  // data URL is stored regardless, so a failed early upload only means the submit path
  // uploads it as it always did.
  function handleSealPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ sealPhotoDataUrl: dataUrl, sealPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ sealPhotoArtifactId: artifactId })
    })
  }

  // Only a format error (a guaranteed backend 422) can stop the driver proceeding.
  const isReady = sealFormatValid && draft.sealPhotoDataUrl !== null

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-lg leading-relaxed text-surface-on-variant">
          Enter the seal number printed on the physical seal and photograph it. The seal number is locked in the journey hash.
        </p>
        <SealInput
          sealNumber={draft.sealNumber}
          sealPhotoDataUrl={draft.sealPhotoDataUrl}
          onSealNumberChange={(v) => onUpdate({ sealNumber: v })}
          onSealPhotoCapture={handleSealPhoto}
        />
        {showSealFormatHint && (
          <p className="text-base text-error">
            Seal number must look like AB-1234 (two letters, four digits).
          </p>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Swipe to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
