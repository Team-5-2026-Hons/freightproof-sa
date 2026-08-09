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
  //
  // driverVisualCount is deliberately NOT part of this gate (2026-08-08). The count is
  // optional at unloading and at confirmation, so `null` is a legitimate value that
  // carries all the way here — gating on it made a skipped count silently unclosable:
  // the swipe stayed disabled forever with nothing on screen explaining why, and the
  // driver's only escape was abandoning a delivered trip. What this phase genuinely
  // cannot be completed without is the POD evidence, which is what remains below.
  const isReady =
    draft.podPhotoDataUrl !== null &&
    Boolean(draft.podSignatureDataUrl)

  // confirmation is gated on the destination warehouse's scan-IN session, exactly as
  // loading is on scan-OUT and unloading on scan-IN (GATED_PHASES, phase_gate.py). Until
  // this landed, this phase was gated server-side and silent here: the driver captured
  // the POD photo, took the receiver's signature and did the reconciliation, then swiped
  // and ate a bare 409 standing at the customer's gate with nothing on screen explaining
  // it. Coalesced to null first for the same reason as loading/Linehaul.tsx — `blocked_on`
  // is optional on the shared type, so `!== null` alone reads `undefined !== null` and is
  // permanently true.
  const isBlocked = (phase.blocked_on ?? null) !== null

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
      {isBlocked ? (
        // No success tick and no swipe while blocked. The trip is NOT complete yet, and
        // showing "Trip Complete" over a control that will 409 tells the driver two
        // false things at once. Same shape as unloading/VisualCount.tsx: hide the
        // control entirely rather than leave it visible-but-disabled, and say why.
        <div className="flex flex-1 flex-col justify-center gap-2 p-4">
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-2">
            <p className="text-sm font-semibold">Waiting for the warehouse</p>
            <p className="text-sm text-surface-on-variant">
              The warehouse is still scanning the parcels in at this stop. The trip will
              close on its own once they finish. Your evidence is saved — no action is
              needed from you.
            </p>
          </div>
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
        </>
      )}
    </main>
  )
}
