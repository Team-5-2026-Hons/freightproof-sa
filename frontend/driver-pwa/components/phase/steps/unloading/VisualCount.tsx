// frontend/driver-pwa/components/phase/steps/unloading/VisualCount.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/phase/StepHeader'
import { Input } from '@/components/ui/Input'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

interface VisualCountProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: UnloadingEvidence
  onUpdate: (patch: Partial<UnloadingEvidence>) => void
  onComplete: () => void | Promise<void>
}

// F1 fence: the old H5VisualCount took an `h2Count` prop and rendered a "Loaded at
// origin (H2)" reference card plus a mismatch banner against it — exactly the kind of
// expected-value display F1 forbids. There is no h2Count prop here and there must never
// be one added back: this is a BLIND entry, same as departure's seal step. The server
// reconciles this count privately (against loading's driver_visual_count and, once
// forwarded, against confirmation's own count) — showing the driver a number to match
// before they've committed their own defeats the purpose of an independent count.
//
// This step now also gates on the warehouse's own destination scan
// (GATED_PHASES[UNLOADING] = ScanDirection.IN, orchestration/phase_gate.py), same
// pattern as loading/Linehaul.tsx — see that file for why the swipe is hidden entirely
// rather than left visible-but-disabled while blocked.
export function VisualCount({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: VisualCountProps) {
  // `blocked_on` is optional on the shared PhaseDescriptor type (not yet guaranteed by
  // every fixture) — `phase.blocked_on !== null` would read `undefined !== null` and be
  // permanently true, so the field is coalesced to null first. Mirrors loading/Linehaul.tsx.
  const isBlocked = (phase.blocked_on ?? null) !== null

  const [input, setInput] = useState(draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '')
  const trimmed = input.trim()
  // Optional-to-type, never optional-to-wait: an empty box is a legitimate "I didn't
  // count" and submits as null. A count that IS typed must still be a real >=0 integer —
  // zero is a legitimate, flaggable observation (a fully pilfered load); a negative
  // count is physically meaningless and never submittable.
  const count = trimmed !== '' ? parseInt(trimmed, 10) : null
  const isValid = count === null || (!isNaN(count) && count >= 0)

  // `unloading`'s final step — see loading/VisualCount.tsx (pre-refactor) for why
  // onComplete's promise is returned rather than dropped.
  function handleConfirm(): void | Promise<void> {
    onUpdate({ driverVisualCount: count })
    return onComplete()
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {isBlocked ? (
          // The server is the authority — it 409s a blocked completion regardless of
          // what this renders (PhaseBlockedError). This is the courteous half: tell the
          // driver why nothing is actionable rather than showing him a control that
          // will fail.
          <WarehouseWaitCard>
            The warehouse is still scanning the parcels off the truck at this stop. This
            will unlock on its own once they finish. No action is needed from you.
          </WarehouseWaitCard>
        ) : (
          <>
            <p className="text-lg leading-relaxed text-surface-on-variant">
              Count the parcels physically unloaded and enter the number below, if you can.
            </p>
            <Input
              label="Your visual count at destination"
              type="number"
              inputMode="numeric"
              // min backs up the >= 0 readiness check at the browser/keyboard level (numeric
              // keypads suppress the minus key when min is non-negative); the JS check above
              // remains the real gate since min alone doesn't stop typed/pasted negatives.
              min={0}
              placeholder="Count unloaded parcels (optional)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        {!isBlocked && (
          <SwipeToConfirm label="Confirm count" onConfirm={handleConfirm} disabled={!isValid} />
        )}
      </div>
    </main>
  )
}
