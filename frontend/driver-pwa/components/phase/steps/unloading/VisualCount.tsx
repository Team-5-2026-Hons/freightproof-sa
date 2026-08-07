// frontend/driver-pwa/components/phase/steps/unloading/VisualCount.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/phase/StepHeader'
import { Input } from '@/components/ui/Input'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
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
// be one added back: this is a BLIND entry, same as loading/VisualCount.tsx. The
// server reconciles this count privately (against loading's driver_visual_count and,
// once forwarded, against confirmation's own count) — showing the driver a number to
// match before they've committed their own defeats the purpose of an independent count.
export function VisualCount({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: VisualCountProps) {
  const [input, setInput] = useState(draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '')
  const count = input !== '' ? parseInt(input, 10) : null
  // >= 0, not > 0: unloading zero parcels is a legitimate, flaggable observation (a fully
  // pilfered load); a negative count is physically meaningless and never submittable.
  const isValidCount = count !== null && !isNaN(count) && count >= 0

  // `unloading`'s final step — see loading/VisualCount.tsx for why onComplete's promise
  // is returned rather than dropped.
  function handleConfirm(): void | Promise<void> {
    onUpdate({ driverVisualCount: count })
    return onComplete()
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-lg leading-relaxed text-surface-on-variant">
          Count the parcels physically unloaded and enter the number below.
        </p>
        <Input
          label="Your visual count at destination"
          type="number"
          inputMode="numeric"
          // min backs up the >= 0 readiness check at the browser/keyboard level (numeric
          // keypads suppress the minus key when min is non-negative); the JS check above
          // remains the real gate since min alone doesn't stop typed/pasted negatives.
          min={0}
          placeholder="Count unloaded parcels"
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
