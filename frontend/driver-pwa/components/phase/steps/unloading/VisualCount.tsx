'use client'

import { useState } from 'react'
import { StepLayout } from '@/components/phase/StepLayout'
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

// Blind entry: there is no h2Count prop and must never be one added back. The server
// reconciles this count privately against loading's driver_visual_count; showing the
// driver a number to match would defeat the purpose of an independent count.
//
// Also gates on the warehouse's own destination scan (GATED_PHASES[UNLOADING],
// orchestration/phase_gate.py) — see loading/Linehaul.tsx for why the swipe is hidden
// entirely rather than left visible-but-disabled while blocked.
export function VisualCount({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: VisualCountProps) {
  // Coalesced to null: `blocked_on` is optional, so a bare `!== null` would read
  // `undefined !== null` and be permanently true.
  const isBlocked = (phase.blocked_on ?? null) !== null

  const [input, setInput] = useState(draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '')
  const trimmed = input.trim()
  // Empty is a legitimate "I didn't count" and submits as null. A typed count must be a
  // real >=0 integer — zero is a valid observation, negative is meaningless.
  const count = trimmed !== '' ? parseInt(trimmed, 10) : null
  const isValid = count === null || (!isNaN(count) && count >= 0)

  function handleConfirm(): void | Promise<void> {
    onUpdate({ driverVisualCount: count })
    return onComplete()
  }

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro={isBlocked ? undefined : 'Count the parcels physically unloaded and enter the number below, if you can.'}
      // No checklist: the count is optional. An invalid entry is explained on the field.
      action={isBlocked ? undefined : (
        <SwipeToConfirm label="Confirm Count" onConfirm={handleConfirm} disabled={!isValid} />
      )}
    >
        {isBlocked ? (
          // Server is the authority (409s regardless); this just tells the driver why.
          <WarehouseWaitCard>
            The warehouse is still scanning the parcels off the truck at this stop. This
            will unlock on its own once they finish. No action is needed from you.
          </WarehouseWaitCard>
        ) : (
          <>
            <Input
              label="Your visual count at destination"
              type="number"
              inputMode="numeric"
              // Backs up the >= 0 check at the keyboard level; the JS check above is the real gate.
              min={0}
              placeholder="Count unloaded parcels (optional)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // Says why the swipe is waiting: a typed count must be a whole number, zero
              // or more. Shown once the field is left, by Input's own touched rule.
              error={isValid ? undefined : 'Enter a whole number of parcels, or leave it blank.'}
            />
          </>
        )}
    </StepLayout>
  )
}
