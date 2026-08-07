// frontend/driver-pwa/components/phase/steps/activation/Verification.tsx
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
  // No readiness gate left. It used to require draft.gpsLat, set by a "Gate Arrival"
  // step that asked the driver to tap "Capture GPS Location" — that step is gone and the
  // app takes the fix as this swipe submits. Nothing else on this phase is
  // driver-captured, so there is nothing left to be incomplete.
  //
  // The GPS and Address review lines went with it: a "Captured" receipt for something
  // that has not happened yet would be a lie, and the driver has no action to take on
  // the answer either way.
  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {/* activation is a feeder phase — the backend only anchors departure and
            confirmation to Hedera HCS (parent plan D7/ANCHORED_PHASES). This evidence
            still matters: it's what those anchored phases are built on. */}
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
