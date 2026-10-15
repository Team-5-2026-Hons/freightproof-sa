// frontend/driver-pwa/components/phase/steps/departure/CaptureSeal.tsx
'use client'

import { useEffect, useRef } from 'react'
import { StepLayout } from '@/components/phase/StepLayout'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { useSealOcr } from '@/lib/hooks/useSealOcr'
import { canReplaceWithOcr } from '@/lib/ocr/sealSource'
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
  const { uploadNow } = useArtifactUpload(tripId, phase.phase_event_id)
  const sealNumber = draft.sealNumber ?? ''
  // The backend 422s any seal not matching XX-#### at submit (departure's last step) —
  // validate here, where the driver can still fix it.
  const sealFormatValid = isValidSealFormat(sealNumber)
  const showSealFormatHint = sealNumber.trim().length > 0 && !sealFormatValid

  const { reading, readSeal } = useSealOcr()
  // The OCR answer is judged against the draft as it is when the answer ARRIVES: the
  // driver may have typed while it ran, and that typing must win.
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  // Upload starts at capture, not at submit — see lib/hooks/useArtifactUpload.ts. The
  // data URL is stored regardless, so a failed early upload only means the submit path
  // uploads it as it always did.
  function handleSealPhoto(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ sealPhotoDataUrl: dataUrl, sealPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt, 'seal_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ sealPhotoArtifactId: artifactId })
    })
    void readSeal(dataUrl).then((result) => {
      if (result.stale) return
      const current = draftRef.current
      // OCR is credited only when it actually fills the field. Filling with null is
      // deliberate: a retake that reads nothing clears an UNTOUCHED earlier read, because a
      // number off a photo the driver has since replaced must not survive as if it came
      // from the new one. Once the driver has made the field their own, their number
      // stands and no OCR value is kept, so it submits as "typed" — even if OCR happened to
      // read the same thing.
      onUpdate(canReplaceWithOcr(current.sealNumber, current.sealNumberOcr ?? null)
        ? { sealNumberOcr: result.value, sealNumber: result.value }
        : { sealNumberOcr: null })
    })
  }

  const readFromPhoto = sealNumber !== '' && sealNumber === (draft.sealNumberOcr ?? null)

  // A format error (a guaranteed backend 422) stops the driver proceeding, and so does a
  // read still running: swiping inside that window would submit a capture tag worked out
  // from the previous photo's read. The read gives up after SEAL_OCR_TIMEOUT_MS.
  const isReady = sealFormatValid && draft.sealPhotoDataUrl !== null && !reading

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Photograph the seal, then check the number. The number is locked into the journey record."
      requirements={[
        { label: 'Seal photo', met: draft.sealPhotoDataUrl !== null },
        { label: 'Seal number', met: sealFormatValid },
      ]}
      action={
        <SwipeToConfirm
          label="Swipe to Save Seal"
          waitingLabel={reading ? 'Reading the seal…' : 'Add photo and number'}
          onConfirm={onComplete}
          disabled={!isReady}
        />
      }
    >
      <SealInput
        sealNumber={draft.sealNumber}
        sealPhotoDataUrl={draft.sealPhotoDataUrl}
        sealPhotoCapturedAt={draft.capturedAt}
        formatError={showSealFormatHint ? 'Seal number must look like AB-1234 (two letters, four digits).' : undefined}
        hint={readFromPhoto ? 'Read from the photo — check it matches the seal.' : undefined}
        reading={reading}
        onSealNumberChange={(v) => onUpdate({ sealNumber: v })}
        onSealPhotoCapture={handleSealPhoto}
      />
    </StepLayout>
  )
}
