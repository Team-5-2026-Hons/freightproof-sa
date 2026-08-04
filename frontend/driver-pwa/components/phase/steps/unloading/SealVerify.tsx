// frontend/driver-pwa/components/phase/steps/unloading/SealVerify.tsx
'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle, Info } from 'lucide-react'
import { StepHeader } from '@/components/phase/StepHeader'
import { Input } from '@/components/ui/Input'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { sealsMatch } from '@/components/phase/sealsMatch'
import { isValidSealFormat } from '@/lib/utils/seal-format'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

interface SealVerifyProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: UnloadingEvidence
  // Seal committed at `departure` (DepartureEvidence.sealNumber), carried forward across
  // the phase boundary by lib/hooks/useSealReference.ts — renamed from h2SealNumber now
  // that the seal is captured at departure, not loading (D7/T5). Must match — the
  // reference no longer comes from a same-trip "H2" concept.
  referenceSealNumber: string | null
  onUpdate: (patch: Partial<UnloadingEvidence>) => void
  onComplete: () => void | Promise<void>
}

// A true mismatch is a flag (a recorded discrepancy); a match or an indeterminate/null
// reference is an ordinary submit — the driver is never punished for a data gap that
// isn't theirs.
const SWIPE_LABEL_SUBMIT = 'Swipe to submit'
const SWIPE_LABEL_FLAG = 'Swipe to flag'
const NO_SEAL_ON_RECORD = 'No seal on record'
// Shown when the departure seal is missing: records the driver's entry without accusing them.
const NULL_REFERENCE_NOTE = 'No seal is on record from departure. The number you enter will be recorded.'

export function SealVerify({ tripId, phase, stepIndex, draft, referenceSealNumber, onUpdate, onComplete }: SealVerifyProps) {
  const [input, setInput] = useState(draft.sealNumberAtDestination ?? '')
  const hasInput = input.trim().length > 0
  // The backend 422s any destination seal not matching XX-#### before the mismatch
  // comparison even runs — so both the submit AND flag paths need a valid format.
  const formatValid = isValidSealFormat(input)
  const showFormatHint = hasInput && !formatValid

  // Three-way verification state. null (indeterminate) means either the driver hasn't typed yet or
  // there is no departure reference seal to compare against — in neither case is it a mismatch. Only
  // a real reference seal that fails to match yields false, the single case that flags a discrepancy.
  function computeMatch(value: string): boolean | null {
    if (value.trim().length === 0 || referenceSealNumber === null) return null
    return sealsMatch(value, referenceSealNumber)
  }

  const matches = computeMatch(input)

  // Persist sealVerifiedMatch alongside the live indicator so a later submit reads an
  // up-to-date draft when onComplete fires — matches CaptureSeal's handleConfirmInput pattern.
  function handleInputChange(value: string) {
    // Uppercase like CaptureSeal's confirm handler — seals are printed uppercase and
    // the backend's format check accepts only uppercase letters.
    const upper = value.toUpperCase()
    setInput(upper)
    onUpdate({
      sealNumberAtDestination: upper,
      sealVerifiedMatch: computeMatch(upper),
    })
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="text-xs text-surface-on-variant mb-1">Seal set at departure</p>
          {referenceSealNumber !== null ? (
            <p className="text-lg font-bold font-mono">{referenceSealNumber}</p>
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
        {showFormatHint && (
          <p className="text-sm text-error">
            Seal number must look like AB-1234 (two letters, four digits).
          </p>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm
          label={matches === false ? SWIPE_LABEL_FLAG : SWIPE_LABEL_SUBMIT}
          variant={matches === false ? 'danger' : 'primary'}
          onConfirm={onComplete}
          disabled={!formatValid}
        />
      </div>
    </main>
  )
}
