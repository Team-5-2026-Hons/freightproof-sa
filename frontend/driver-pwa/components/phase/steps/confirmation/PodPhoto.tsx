// POD photo step; the receiver's signature is captured in ReceiverHandover.
'use client'

import { StepLayout } from '@/components/phase/StepLayout'
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
  const { uploadNow } = useArtifactUpload(tripId, phase.phase_event_id)

  function handleCapture(dataUrl: string) {
    const capturedAt = new Date().toISOString()
    onUpdate({ podPhotoDataUrl: dataUrl, podPhotoArtifactId: null, capturedAt })
    void uploadNow(dataUrl, 'photo', capturedAt, 'pod_photo').then((artifactId) => {
      if (artifactId !== null) onUpdate({ podPhotoArtifactId: artifactId })
    })
  }

  const hasPhoto = draft.podPhotoDataUrl !== null

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Show the delivered cargo where it was left."
      requirements={[{ label: 'Delivery photo', met: hasPhoto }]}
      action={
        <SwipeToConfirm
          label="Swipe to Save Photo"
          waitingLabel="Add the delivery photo first"
          onConfirm={onComplete}
          disabled={!hasPhoto}
        />
      }
    >
      <CameraCapture
        label="Delivery photo"
        hint="Whole load in frame"
        dataUrl={draft.podPhotoDataUrl}
        capturedAt={draft.capturedAt}
        onCapture={handleCapture}
      />
    </StepLayout>
  )
}
