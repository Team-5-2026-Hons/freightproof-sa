'use client'

import { StepLayout } from '@/components/phase/StepLayout'
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
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      // activation is a feeder phase — only departure and confirmation are anchored.
      intro="Swipe to start this trip. Your location is recorded automatically. This is the evidence that supports your anchored Departure and Confirmation phases."
      action={<SwipeToConfirm label="Submit" onConfirm={onComplete} />}
    />
  )
}
