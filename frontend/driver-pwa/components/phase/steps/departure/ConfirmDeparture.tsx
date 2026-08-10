// frontend/driver-pwa/components/phase/steps/departure/ConfirmDeparture.tsx
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
  // Gates on the driver's OWN capture from the previous step (CaptureSeal), because that
  // is now the only seal evidence departure collects — the guard's re-typed confirmation
  // it used to require was removed with the step that asked for it (2026-08-05, see
  // CaptureSeal's header comment). Both halves are checked, not just the number: this is
  // the last screen before submitPhase, whose departure branch throws locally without a
  // seal photo, and a swipe that can only fail is worse than a disabled one.
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
            // receipt here would be claiming something that hasn't happened yet.
            //
            // The driver's own seal capture, replacing the guard's re-typed
            // confirmation this row used to report — that step is gone (CaptureSeal's
            // header comment). Dropping the row outright would leave an "Evidence
            // collected" card with nothing in it on the last screen before submit;
            // showing what IS being submitted is the point of the review.
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
