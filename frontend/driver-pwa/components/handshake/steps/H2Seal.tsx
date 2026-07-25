// frontend/driver-pwa/components/handshake/steps/H2Seal.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { SealInput } from '@/components/handshake/SealInput'
import { HoldButton } from '@/components/handshake/HoldButton'
import { isValidSealFormat } from '@/lib/utils/seal-format'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2SealProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2Seal({ tripId, draft, onUpdate, onComplete }: H2SealProps) {
  const sealNumber = draft.sealNumber ?? ''
  // The backend 422s any seal not matching XX-#### at submit — which happens at the END
  // of H2 (step 5 review), after every photo is taken. Validate here, where the driver
  // can still fix it, instead of surfacing a raw 422 toast three screens later.
  const sealFormatValid = isValidSealFormat(sealNumber)
  const showFormatHint = sealNumber.trim().length > 0 && !sealFormatValid
  const isReady = sealFormatValid && draft.sealPhotoDataUrl !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshake={2} step={4} />
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
        {showFormatHint && (
          <p className="text-sm text-error">
            Seal number must look like AB-1234 (two letters, four digits).
          </p>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
