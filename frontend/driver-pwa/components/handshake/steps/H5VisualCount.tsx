// frontend/driver-pwa/components/handshake/steps/H5VisualCount.tsx
'use client'

import { useState } from 'react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5VisualCountProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
  h2Count: number | null   // loading count to compare against
}

export function H5VisualCount({ tripId, draft, onUpdate, onComplete, h2Count }: H5VisualCountProps) {
  const [input, setInput] = useState(draft.driverVisualCount !== null ? String(draft.driverVisualCount) : '')
  const count = input !== '' ? parseInt(input, 10) : null
  // >= 0, not > 0: unloading zero parcels is a legitimate, flaggable observation (a fully
  // pilfered load); a negative count is physically meaningless and never submittable.
  const isValidCount = count !== null && !isNaN(count) && count >= 0
  const hasMismatch = isValidCount && h2Count !== null && count !== h2Count

  function handleConfirm() {
    onUpdate({ driverVisualCount: count })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshake={5} step={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {h2Count !== null && (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
            <p className="text-xs text-surface-on-variant mb-1">Loaded at origin (H2)</p>
            <p className="text-2xl font-bold">{h2Count} parcels</p>
          </div>
        )}
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
        {hasMismatch && (
          <div className="rounded-xl bg-error-container px-4 py-3">
            <p className="text-sm font-medium text-error-on-container">
              Count mismatch: loaded {h2Count}, you counted {count}. This discrepancy will be recorded for review.
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Confirm count" onConfirm={handleConfirm} disabled={!isValidCount} />
      </div>
    </main>
  )
}
