'use client'

import { StepLayout } from '@/components/phase/StepLayout'
import { EvidenceReview } from '@/components/phase/EvidenceReview'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

interface ConfirmDepartureProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: DepartureEvidence
  onComplete: () => void | Promise<void>
}

export function ConfirmDeparture({ tripId, phase, stepIndex, draft, onComplete }: ConfirmDepartureProps) {
  // Both halves checked, not just the number: submitPhase's departure branch throws
  // locally without a seal photo, and a swipe that can only fail is worse than a disabled one.
  const isReady = draft.sealNumber !== null && draft.sealPhotoDataUrl !== null

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      // Names the control the driver actually sees ("Depart") — the old copy said "Swipe to
      // Submit" above a swipe labelled Depart.
      intro="You are about to depart. Swipe Depart to record your departure; you are then in transit."
      requirements={[
        { label: 'Seal number', met: draft.sealNumber !== null },
        { label: 'Seal photo', met: draft.sealPhotoDataUrl !== null },
      ]}
      action={<SwipeToConfirm label="Depart" onConfirm={onComplete} disabled={!isReady} />}
    >
        <EvidenceReview
          items={[
            // No GPS line: the fix is taken as this swipe submits, so a "Captured"
            // receipt here would claim something that hasn't happened yet.
            { label: 'Seal number', value: draft.sealNumber },
            { label: 'Seal photo', value: draft.sealPhotoDataUrl, isImage: true },
          ]}
        />
    </StepLayout>
  )
}
