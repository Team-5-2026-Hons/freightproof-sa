'use client'

import { CheckCircle2 } from 'lucide-react'
import { StepHeader } from '@/components/phase/StepHeader'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

interface ClosedProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onComplete: () => void | Promise<void>
}

export function Closed({ tripId, phase, stepIndex, draft, onComplete }: ClosedProps) {
  // Only THIS phase's draft: unloading fields (waybillHandedOver etc.) belong to a
  // separate phase_event_id and are already resolved server-side by this point.
  // driverVisualCount is deliberately excluded — it's optional, and gating on it made a
  // skipped count silently unclosable. The signature half is the receiver's confirmation
  // (FP-155), so this checks the artifact id the handover poll wrote into the draft.
  const isReady =
    draft.podPhotoDataUrl !== null &&
    Boolean(draft.podSignatureArtifactId)

  // Gated on the destination warehouse's scan-IN session (GATED_PHASES, phase_gate.py).
  // Coalesced to null first: `blocked_on` is optional on the shared type, so a bare
  // `!== null` reads `undefined !== null` and is permanently true.
  const isBlocked = (phase.blocked_on ?? null) !== null

  // Navigation stays with the caller: onComplete() submits, clears the draft, and
  // advances. Its promise is returned so SwipeToConfirm holds the "Submitting…" lock.
  function handleClose(): void | Promise<void> {
    return onComplete()
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      {isBlocked ? (
        // No success tick and no swipe while blocked: hide the control entirely rather
        // than leave it visible-but-disabled, and say why.
        <div className="flex flex-1 flex-col justify-center gap-2 p-4">
          <WarehouseWaitCard>
            The warehouse is still scanning the parcels in at this stop. The trip will
            close on its own once they finish. Your evidence is saved — no action is
            needed from you.
          </WarehouseWaitCard>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-10 w-10 text-success" strokeWidth={2} aria-hidden />
            </div>
            <div>
              <p className="text-xl font-bold">Trip Complete</p>
              <p className="mt-1 text-base text-surface-on-variant">
                All phases are complete. Evidence has been recorded.
              </p>
            </div>
          </div>
          <div className="flex justify-center px-6 pt-6 pb-safe">
            <SwipeToConfirm label="Close trip" onConfirm={handleClose} disabled={!isReady} />
          </div>
        </>
      )}
    </main>
  )
}
