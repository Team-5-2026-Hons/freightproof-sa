// frontend/driver-pwa/components/phase/steps/confirmation/Closed.tsx
'use client'

import { CheckCircle2 } from 'lucide-react'
import { StepHeader } from '@/components/phase/StepHeader'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
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
  // Old H5Closed's isReady also checked waybillHandedOver/sealBrokenPhotoDataUrl — those
  // are `unloading` phase fields, not on ConfirmationEvidence (see Reconciliation.tsx's
  // header comment: separate phase_event_id, separate draft). By the time the driver
  // reaches confirmation's last step, unloading is already a resolved phase server-side;
  // this gate is limited to what THIS phase's own draft carries.
  const isReady =
    draft.driverVisualCount !== null &&
    draft.podPhotoDataUrl !== null &&
    Boolean(draft.podSignatureDataUrl)

  // Navigation is owned by the caller: onComplete() triggers the real submission: awaits
  // it, clears this phase's draft, and advances. Navigating here too would race that
  // async submission and land on an unmounted/stale screen. Its promise is returned, not
  // dropped — that promise is how SwipeToConfirm knows to hold the "Submitting…" lock
  // for the whole trip-closing round trip instead of handing the track straight back.
  function handleClose(): void | Promise<void> {
    return onComplete()
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-10 w-10 text-success" strokeWidth={2} aria-hidden />
        </div>
        <div>
          <p className="text-xl font-bold">Trip Complete</p>
          <p className="mt-1 text-base text-surface-on-variant">
            {/* No longer "All five handshakes are done" — the plan's length is DATA
                (parent plan §2.2); a cross-dock trip has more phases than a single-leg
                one, and this screen must never imply a fixed count. */}
            All phases are complete. Evidence has been recorded.
          </p>
        </div>
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Close trip" onConfirm={handleClose} disabled={!isReady} />
      </div>
    </main>
  )
}
