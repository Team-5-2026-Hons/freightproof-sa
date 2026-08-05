// frontend/driver-pwa/components/phase/steps/confirmation/PodSignature.tsx
// BQ2 resolved 2026-06-29: proof of delivery is a photo of the delivered cargo
// AND an on-device signature from the receiver — both required. This step captures the
// signature half; PodPhoto.tsx (the previous step) captures the photo half.
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { SignaturePad } from '@/components/phase/SignaturePad'
import { useArtifactUpload } from '@/lib/hooks/useArtifactUpload'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
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

  // The signature uploads as soon as the driver lifts their finger, not at submit — the
  // receiver still has to hand the phone back, which is free upload time. An empty pad
  // clears both fields; anything else stores the data URL and races the upload.
  function handleSignature(dataUrl: string) {
    if (!dataUrl) {
      onUpdate({ podSignatureDataUrl: null, podSignatureArtifactId: null })
      return
    }
    const capturedAt = new Date().toISOString()
    onUpdate({ podSignatureDataUrl: dataUrl, podSignatureArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'document', capturedAt).then((artifactId) => {
      if (artifactId !== null) onUpdate({ podSignatureArtifactId: artifactId })
    })
  }
  const hasSignature = Boolean(draft.podSignatureDataUrl)

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Have the receiver sign to confirm delivery.
        </p>
        <SignaturePad
          label="Receiver signature"
          dataUrl={draft.podSignatureDataUrl}
          onCapture={handleSignature}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Confirm POD" onConfirm={onComplete} disabled={!hasSignature} />
      </div>
    </main>
  )
}
