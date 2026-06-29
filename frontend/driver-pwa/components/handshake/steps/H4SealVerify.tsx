// frontend/driver-pwa/components/handshake/steps/H4SealVerify.tsx
'use client'

import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
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

export function H4SealVerify({ tripId, draft, h2SealNumber, onUpdate, onComplete }: H4SealVerifyProps) {
  const [input, setInput] = useState(draft.sealNumberAtDestination ?? '')
  const matches = sealsMatch(input, h2SealNumber)
  const hasInput = input.trim().length > 0

  // Persist sealVerifiedMatch alongside the live indicator so the dispatcher's submitAndAdvance
  // reads an up-to-date draft when onComplete fires — matches H3's handleSealInput pattern
  // (the literal task snippet never called onUpdate at all, which was a real persistence gap).
  function handleInputChange(value: string) {
    setInput(value)
    onUpdate({
      sealNumberAtDestination: value,
      sealVerifiedMatch: value.trim().length > 0 ? sealsMatch(value, h2SealNumber) : null,
    })
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Destination Gate-In" stepName="Seal Verification" stepIndex={3} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="text-xs text-surface-on-variant mb-1">Seal set at loading (H2)</p>
          <p className="text-lg font-bold font-mono">{h2SealNumber ?? 'Unknown'}</p>
        </div>
        <Input
          label="Enter seal number from vehicle"
          placeholder="Type the seal number you see"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
        />
        {hasInput && (
          <div className={`flex items-center gap-2 rounded-xl px-4 py-3 ${matches ? 'bg-success/10' : 'bg-error-container'}`}>
            {matches ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" strokeWidth={2} aria-hidden />
            ) : (
              <XCircle className="h-5 w-5 shrink-0 text-error-on-container" strokeWidth={2} aria-hidden />
            )}
            <p className={`text-sm font-medium ${matches ? 'text-success' : 'text-error-on-container'}`}>
              {matches ? 'Seal matches — integrity confirmed' : 'Mismatch — this discrepancy will be recorded for review.'}
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton
          label={matches ? 'Submit H4' : 'Submit (flag mismatch)'}
          variant={matches ? 'primary' : 'danger'}
          onConfirm={onComplete}
          disabled={!hasInput}
        />
      </div>
    </main>
  )
}
