// frontend/driver-pwa/components/phase/steps/confirmation/PodSignature.tsx
// BQ2 resolved 2026-06-29: proof of delivery is a photo of the delivered cargo
// AND an on-device signature from the receiver — both required. This step captures the
// signature half; PodPhoto.tsx (the previous step) captures the photo half.
//
// The signature half is now a swipe attestation stamped with the time and position of
// signing, not a drawn mark (see components/phase/DigitalSignature.tsx). BQ2's "both
// required" still holds — the artifact is still produced, uploaded and required at
// submit — but its "on-device signature" is now a deliberate swipe rather than a
// handwritten one. Flagged for the team as a change to a resolved decision.
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { DigitalSignature, type DigitalSignatureResult } from '@/components/phase/DigitalSignature'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

interface PodSignatureProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onUpdate: (patch: Partial<ConfirmationEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function PodSignature({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: PodSignatureProps) {
  const { uploadNow } = useArtifactUpload(tripId)

  // The attestation uploads the moment it is signed, not at submit — the receiver still
  // has to hand the phone back, which is free upload time. The rendered PNG goes into
  // the draft first so a failed upload still leaves the artifact for the submit path to
  // re-send (see useArtifactUpload's header).
  //
  // The swipe both signs and completes the step: a second "Confirm POD" swipe directly
  // beneath the signing swipe would ask the receiver to perform the same gesture twice
  // to express one intent.
  async function handleSign({ dataUrl, signedAt }: DigitalSignatureResult) {
    onUpdate({ podSignatureDataUrl: dataUrl, podSignatureArtifactId: null, capturedAt: signedAt })
    void uploadNow(dataUrl, 'document', signedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ podSignatureArtifactId: artifactId })
    })
    await onComplete()
  }

  // Already signed — the driver navigated back to review the attestation. DigitalSignature
  // renders the artifact but no swipe in that state (there is nothing left to sign), so
  // the step needs its own way forward or the driver is stranded here.
  const isSigned = draft.podSignatureDataUrl !== null

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          {isSigned
            ? 'Delivery has been digitally signed.'
            : 'Hand the phone to the receiver to confirm delivery.'}
        </p>
        <DigitalSignature
          tripId={tripId}
          dataUrl={draft.podSignatureDataUrl}
          onSign={handleSign}
        />
      </div>
      {isSigned && (
        <div className="flex justify-center px-6 pt-6 pb-safe">
          <SwipeToConfirm label="Continue" onConfirm={onComplete} />
        </div>
      )}
    </main>
  )
}
