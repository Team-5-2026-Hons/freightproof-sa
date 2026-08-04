// frontend/driver-pwa/components/phase/steps/departure/CaptureSeal.tsx
'use client'

import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { StepHeader } from '@/components/phase/StepHeader'
import { SealInput } from '@/components/phase/SealInput'
import { Input } from '@/components/ui/Input'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { sealsMatch } from '@/components/phase/sealsMatch'
import { isValidSealFormat } from '@/lib/utils/seal-format'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

interface CaptureSealProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: DepartureEvidence
  onUpdate: (patch: Partial<DepartureEvidence>) => void
  onComplete: () => void | Promise<void>
}

// Highest-risk edit in the phase refactor (parent plan §5.4, §2.6, D7). The seal used to
// be captured at `loading` (old H2Seal) and independently re-typed for comparison at
// gate-out (old H3ExitSeal) — two different handshakes, bridged by
// lib/hooks/useSealReference.ts. Both ends now live in ONE phase (`departure`), and
// because departure's recipe has exactly four steps with no separate slot for the guard's
// confirmation (STEP_SLUGS.departure in phase-meta.ts), they live on this SAME step —
// H3ExitSeal is retired, not just renamed; its confirmation UI and sealsMatch() import
// moved here.
//
// The failure mode the parent plan warns about is a SILENT one: a stale or never-set
// reference comparing as `false` (mismatch) when it should be indeterminate, or comparing
// as `true` against an empty string. `matches` below is null — never false — whenever
// draft.sealNumber hasn't been typed yet, exactly mirroring the null-safety sealsMatch()
// itself already guarantees (an empty/null side never reports a match).
export function CaptureSeal({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: CaptureSealProps) {
  const sealNumber = draft.sealNumber ?? ''
  // The backend 422s any seal not matching XX-#### at submit (departure's last step) —
  // validate here, where the driver can still fix it.
  const sealFormatValid = isValidSealFormat(sealNumber)
  const showSealFormatHint = sealNumber.trim().length > 0 && !sealFormatValid

  const confirmInput = draft.sealNumberConfirmed ?? ''
  const hasConfirmInput = confirmInput.trim().length > 0
  const confirmFormatValid = isValidSealFormat(confirmInput)
  const showConfirmFormatHint = hasConfirmInput && !confirmFormatValid

  // Reference is THIS SAME draft's own sealNumber — no cross-phase bridge needed for
  // departure's own gate (DepartureEvidence's header comment in evidence-draft.ts).
  // null (not false) whenever the driver hasn't typed a seal number yet.
  const matches = draft.sealNumber === null ? null : sealsMatch(confirmInput, draft.sealNumber)

  function handleConfirmInput(value: string) {
    const upper = value.toUpperCase()
    onUpdate({
      sealNumberConfirmed: upper,
      // null (not false) when there's nothing to compare against yet — the persisted
      // three-way state must agree with the live indicator below.
      sealVerifiedMatch:
        upper.trim().length > 0 && draft.sealNumber !== null ? sealsMatch(upper, draft.sealNumber) : null,
    })
  }

  // A mismatch is flagged as an exception downstream, never blocked here — only a format
  // error (a guaranteed backend 422) can stop the driver from proceeding.
  const isReady = sealFormatValid && draft.sealPhotoDataUrl !== null && confirmFormatValid

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Enter the seal number printed on the physical seal and photograph it. The seal number is locked in the journey hash.
        </p>
        <SealInput
          sealNumber={draft.sealNumber}
          sealPhotoDataUrl={draft.sealPhotoDataUrl}
          onSealNumberChange={(v) => onUpdate({ sealNumber: v })}
          onSealPhotoCapture={(dataUrl) => onUpdate({ sealPhotoDataUrl: dataUrl })}
        />
        {showSealFormatHint && (
          <p className="text-sm text-error">
            Seal number must look like AB-1234 (two letters, four digits).
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-outline-variant pt-6">
          <p className="text-sm text-surface-on-variant">
            Have the gate guard independently re-enter the seal number to confirm it.
          </p>
          <Input
            label="Guard confirms seal number"
            placeholder="e.g. FP-1234"
            value={confirmInput}
            onChange={(e) => handleConfirmInput(e.target.value)}
          />
          {/* Same three-card visual language as unloading/SealVerify.tsx: match gets the
              success tint, mismatch gets the full bg-error-container alert card, no-input
              stays a neutral note. A mismatch here flags a CRITICAL seal exception
              (possible tamper-and-reseal at the gate) and must look like one. */}
          {hasConfirmInput && matches === true && (
            <div className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" strokeWidth={2} aria-hidden />
              <p className="text-sm font-medium text-success">Seal matches</p>
            </div>
          )}
          {hasConfirmInput && matches === false && (
            <div className="flex items-center gap-2 rounded-xl bg-error-container px-4 py-3">
              <XCircle className="h-5 w-5 shrink-0 text-error-on-container" strokeWidth={2} aria-hidden />
              <p className="text-sm font-medium text-error-on-container">Mismatch — flagged as exception</p>
            </div>
          )}
          {hasConfirmInput && matches === null && (
            <div className="flex items-center gap-2 rounded-xl bg-surface-container-low px-4 py-3">
              <Info className="h-5 w-5 shrink-0 text-surface-on-variant" strokeWidth={2} aria-hidden />
              <p className="text-sm font-medium text-surface-on-variant">
                Enter the seal number above before confirming it.
              </p>
            </div>
          )}
          {showConfirmFormatHint && (
            <p className="text-sm text-error">
              Seal number must look like AB-1234 (two letters, four digits).
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Swipe to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
