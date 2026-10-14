'use client'

import { StepHeader } from '@/components/phase/StepHeader'
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
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-lg leading-relaxed text-surface-on-variant">
          You are about to depart. Swipe to submit. Your departure is recorded and you are now in transit.
        </p>
        <EvidenceReview
          items={[
            // No GPS line: the fix is taken as this swipe submits, so a "Captured"
            // receipt here would claim something that hasn't happened yet.
            { label: 'Seal number', value: draft.sealNumber },
            { label: 'Seal photo', value: draft.sealPhotoDataUrl, isImage: true },
          ]}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Depart" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
