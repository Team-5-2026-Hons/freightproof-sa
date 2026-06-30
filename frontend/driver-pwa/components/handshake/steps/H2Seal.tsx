// frontend/driver-pwa/components/handshake/steps/H2Seal.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { SealInput } from '@/components/handshake/SealInput'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2SealProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2Seal({ tripId, draft, onUpdate, onComplete }: H2SealProps) {
  const isReady = Boolean(draft.sealNumber?.trim()) && draft.sealPhotoDataUrl !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Loading" stepName="Capture Seal" stepIndex={4} totalSteps={5} />
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
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
