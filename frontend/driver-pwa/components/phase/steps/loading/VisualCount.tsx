// frontend/driver-pwa/components/phase/steps/loading/VisualCount.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/phase/StepHeader'
import { Input } from '@/components/ui/Input'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { LoadingEvidence } from '@/lib/types/evidence-draft'

interface VisualCountProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: LoadingEvidence
  onUpdate: (patch: Partial<LoadingEvidence>) => void
  onComplete: () => void | Promise<void>
}

// NEW step (parent plan §5.4 / D11 / project rule F1). `loading`'s only driver input is a
// BLIND visual count — no expected value, no Parcel Perfect figure, no mismatch banner is
// ever rendered here, deliberately. A count entered while the expected number is already
// on screen proves nothing about what the driver actually saw; the server reconciles this
// count privately against Parcel Perfect and against `confirmation`'s destination count
// once both exist. Do not add a reference value or a comparison banner to this component —
// doing so defeats the entire reason this step exists as a separate, blind entry.
export function VisualCount({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: VisualCountProps) {
  const [input, setInput] = useState(
    draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '',
  )
  const count = input !== '' ? parseInt(input, 10) : null
  // >= 0, not > 0: an empty load (0) is a legitimate, flaggable observation — the driver
  // reporting "nothing was loaded" is exactly the kind of evidence this app records. A
  // negative count is physically meaningless, so it can never be ready to submit.
  const isValidCount = count !== null && !isNaN(count) && count >= 0

  // Returns onComplete's result rather than calling it bare: this is `loading`'s FINAL
  // step, so onComplete is the real submit and hands back a promise. Dropping it here
  // would hide the in-flight submit from SwipeToConfirm, which unlocks its track the
  // moment it believes the work is done.
  function handleConfirm(): void | Promise<void> {
    if (!isValidCount) return
    onUpdate({ driverVisualCount: count, capturedAt: new Date().toISOString() })
    return onComplete()
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Count the parcels physically loaded and enter the number below.
        </p>
        <Input
          label="Your visual count"
          type="number"
          inputMode="numeric"
          // min backs up the >= 0 readiness check at the browser/keyboard level (numeric
          // keypads suppress the minus key when min is non-negative); the JS check above
          // remains the real gate since min alone doesn't stop typed/pasted negatives.
          min={0}
          placeholder="Count units physically"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Confirm count" onConfirm={handleConfirm} disabled={!isValidCount} />
      </div>
    </main>
  )
}
