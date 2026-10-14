'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ActivationEvidence } from '@/lib/types/evidence-draft'

interface VerificationProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  // Kept in the prop shape (unread) because renderStep hands every step component the
  // same set — activation simply has no driver-captured evidence left to review.
  draft: ActivationEvidence
  onComplete: () => void | Promise<void>
}

export function Verification({ tripId, phase, stepIndex, onComplete }: VerificationProps) {
  // No readiness gate: the GPS fix is taken as this swipe submits, and nothing else on
  // this phase is driver-captured.
  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {/* activation is a feeder phase — only departure and confirmation are anchored. */}
        <p className="text-lg leading-relaxed text-surface-on-variant">
          Swipe to start this trip. Your location is recorded automatically. This is the
          evidence that supports your anchored Departure and Confirmation phases.
        </p>
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Submit" onConfirm={onComplete} />
      </div>
    </main>
  )
}
