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
  // sealNumberConfirmed is set by the previous step (CaptureSeal, which now owns both the
  // capture AND the guard's confirmation entry — see that file's header comment) — this
  // gate simply requires it exists before departure is submitted.
  const isReady = draft.sealNumberConfirmed !== null

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          You are about to depart. Swipe to submit — your departure is recorded and you are now in transit.
        </p>
        <EvidenceReview
          items={[
            // No GPS line: the fix is taken as this swipe submits, so a "Captured"
            // receipt here would be claiming something that hasn't happened yet.
            {
              label: 'Seal confirmed',
              value:
                draft.sealNumberConfirmed === null
                  ? null
                  : `${draft.sealNumberConfirmed}${draft.sealVerifiedMatch === false ? ' (mismatch)' : ''}`,
            },
          ]}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Depart" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
