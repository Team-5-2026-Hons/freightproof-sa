// frontend/driver-pwa/components/handshake/steps/H3ExitSeal.tsx
'use client'

import { CheckCircle2, XCircle } from 'lucide-react'
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

export function H3ExitSeal({ tripId, draft, h2SealNumber, onUpdate, onComplete }: H3ExitSealProps) {
  const input = draft.sealNumberConfirmed ?? ''
  const hasInput = input.trim().length > 0
  const matches = input.trim().toUpperCase() === (h2SealNumber ?? '').toUpperCase()
  const isReady = draft.gatePhotoDataUrl !== null && hasInput

  function handleSealInput(value: string) {
    const upper = value.toUpperCase()
    // Frontend doesn't decide validity — it records what the driver typed and whether it
    // matches H2's seal; a mismatch is flagged as an exception downstream, not blocked here.
    onUpdate({
      sealNumberConfirmed: upper,
      sealVerifiedMatch: upper.trim().length > 0 ? upper.trim() === (h2SealNumber ?? '').toUpperCase() : null,
    })
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Origin Gate-Out" stepName="Exit Photo & Seal" stepIndex={2} totalSteps={3} />
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
            {matches ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} aria-hidden />
                <p className="text-sm font-medium text-success">Seal matches</p>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 text-error" strokeWidth={2} aria-hidden />
                <p className="text-sm font-medium text-error">Mismatch — flagged as exception</p>
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
