// frontend/driver-pwa/components/handshake/steps/H4SealVerify.tsx
'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, Info } from 'lucide-react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import { sealsMatch } from './H3ExitSeal'
import type { H4Evidence } from '@/lib/types/evidence-draft'

interface H4SealVerifyProps {
  tripId: string
  draft: H4Evidence
  h2SealNumber: string | null   // seal set at loading — must match
  onUpdate: (patch: Partial<H4Evidence>) => void
  onComplete: () => void
}

// HoldButton labels are capped at ~16 chars by the button's fixed 80px face. A true mismatch is a
// flag (a recorded discrepancy); a match or an indeterminate/null reference is an ordinary submit —
// the driver is never punished for a data gap that isn't theirs.
const HOLD_LABEL_SUBMIT = 'Hold to submit'
const HOLD_LABEL_FLAG = 'Hold to flag'
const NO_SEAL_ON_RECORD = 'No seal on record'
// Shown when the loading seal is missing: records the driver's entry without accusing them.
const NULL_REFERENCE_NOTE = 'No seal is on record from loading. The number you enter will be recorded.'

export function H4SealVerify({ tripId, draft, h2SealNumber, onUpdate, onComplete }: H4SealVerifyProps) {
  const [input, setInput] = useState(draft.sealNumberAtDestination ?? '')
  const hasInput = input.trim().length > 0

  // Three-way verification state. null (indeterminate) means either the driver hasn't typed yet or
  // there is no H2 reference seal to compare against — in neither case is it a mismatch. Only a real
  // reference seal that fails to match yields false, the single case that flags a discrepancy.
  function computeMatch(value: string): boolean | null {
    if (value.trim().length === 0 || h2SealNumber === null) return null
    return sealsMatch(value, h2SealNumber)
  }

  const matches = computeMatch(input)

  // Persist sealVerifiedMatch alongside the live indicator so the dispatcher's submitAndAdvance
  // reads an up-to-date draft when onComplete fires — matches H3's handleSealInput pattern.
  function handleInputChange(value: string) {
    setInput(value)
    onUpdate({
      sealNumberAtDestination: value,
      sealVerifiedMatch: computeMatch(value),
    })
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Destination Gate-In" stepName="Seal Verification" stepIndex={3} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="text-xs text-surface-on-variant mb-1">Seal set at loading</p>
          {h2SealNumber !== null ? (
            <p className="text-lg font-bold font-mono">{h2SealNumber}</p>
          ) : (
            <p className="text-sm text-surface-on-variant">{NO_SEAL_ON_RECORD}</p>
          )}
        </div>
        <Input
          label="Enter seal number from vehicle"
          placeholder="Type the seal number you see"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
        />
        {hasInput && matches === true && (
          <div className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" strokeWidth={2} aria-hidden />
            <p className="text-sm font-medium text-success">Seal matches — integrity confirmed</p>
          </div>
        )}
        {hasInput && matches === false && (
          <div className="flex items-center gap-2 rounded-xl bg-error-container px-4 py-3">
            <XCircle className="h-5 w-5 shrink-0 text-error-on-container" strokeWidth={2} aria-hidden />
            <p className="text-sm font-medium text-error-on-container">
              Mismatch — this discrepancy will be recorded for review.
            </p>
          </div>
        )}
        {hasInput && matches === null && (
          <div className="flex items-center gap-2 rounded-xl bg-surface-container-low px-4 py-3">
            <Info className="h-5 w-5 shrink-0 text-surface-on-variant" strokeWidth={2} aria-hidden />
            <p className="text-sm font-medium text-surface-on-variant">{NULL_REFERENCE_NOTE}</p>
          </div>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton
          label={matches === false ? HOLD_LABEL_FLAG : HOLD_LABEL_SUBMIT}
          variant={matches === false ? 'danger' : 'primary'}
          onConfirm={onComplete}
          disabled={!hasInput}
        />
      </div>
    </main>
  )
}
