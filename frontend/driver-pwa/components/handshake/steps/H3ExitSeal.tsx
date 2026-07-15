// frontend/driver-pwa/components/handshake/steps/H3ExitSeal.tsx
'use client'

import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H3Evidence } from '@/lib/types/evidence-draft'

interface H3ExitSealProps {
  tripId: string
  draft: H3Evidence
  h2SealNumber: string | null
  onUpdate: (patch: Partial<H3Evidence>) => void
  onComplete: () => void
}

// Case-insensitive, whitespace-tolerant seal comparison shared by the live "matches" indicator
// and the persisted sealVerifiedMatch field, so the two can never drift out of sync (the bug
// class found in Task 9 review). A null/empty reference seal (h2SealNumber) never matches.
export function sealsMatch(a: string, b: string | null): boolean {
  const normalizedA = a.trim().toUpperCase()
  const normalizedB = (b ?? '').trim().toUpperCase()
  return normalizedA.length > 0 && normalizedA === normalizedB
}

export function H3ExitSeal({ tripId, draft, h2SealNumber, onUpdate, onComplete }: H3ExitSealProps) {
  const input = draft.sealNumberConfirmed ?? ''
  const hasInput = input.trim().length > 0
  // Three-way like H4SealVerify: null means the device has no H2 seal reference to
  // compare against (reinstall, cleared storage) — that is NOT a mismatch. The server
  // compares the submitted seal against H2's committed seal either way; only a real
  // local reference that fails to match should show the mismatch flag.
  const matches = h2SealNumber === null ? null : sealsMatch(input, h2SealNumber)
  const isReady = draft.gatePhotoDataUrl !== null && hasInput

  function handleSealInput(value: string) {
    const upper = value.toUpperCase()
    // Frontend doesn't decide validity — it records what the driver typed and whether it
    // matches H2's seal; a mismatch is flagged as an exception downstream, not blocked here.
    onUpdate({
      // null (not false) when there's no local reference — the persisted three-way state
      // must agree with the indicator above, and a missing reference is not a mismatch.
      sealVerifiedMatch:
        upper.trim().length > 0 && h2SealNumber !== null ? sealsMatch(upper, h2SealNumber) : null,
      sealNumberConfirmed: upper,
    })
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Origin Gate-Out" stepName="Exit Photo & Seal" stepIndex={2} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the exit gate, then re-enter the seal number to confirm it matches what was set at loading.
        </p>
        <CameraCapture
          label="Exit gate photo"
          dataUrl={draft.gatePhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ gatePhotoDataUrl: dataUrl })}
        />
        <Input
          label="Confirm seal number"
          placeholder="e.g. FP-1234"
          value={input}
          onChange={(e) => handleSealInput(e.target.value)}
        />
        {hasInput && (
          <div className="flex items-center gap-2 rounded-xl bg-surface-container-lowest px-4 py-3">
            {matches === true && (
              <>
                <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} aria-hidden />
                <p className="text-sm font-medium text-success">Seal matches</p>
              </>
            )}
            {matches === false && (
              <>
                <XCircle className="h-5 w-5 text-error" strokeWidth={2} aria-hidden />
                <p className="text-sm font-medium text-error">Mismatch — flagged as exception</p>
              </>
            )}
            {matches === null && (
              <>
                <Info className="h-5 w-5 shrink-0 text-surface-on-variant" strokeWidth={2} aria-hidden />
                <p className="text-sm font-medium text-surface-on-variant">
                  No seal is on record on this device — the number you enter is verified against
                  the loading seal when you submit.
                </p>
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
