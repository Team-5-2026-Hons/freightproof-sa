// frontend/driver-pwa/components/handshake/steps/H3ExitSeal.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { Input } from '@/components/ui/Input'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H3Evidence } from '@/lib/types/evidence-draft'

interface H3ExitSealProps {
  tripId: string
  draft: H3Evidence
  onUpdate: (patch: Partial<H3Evidence>) => void
  onComplete: () => void
}

export function H3ExitSeal({ tripId, draft, onUpdate, onComplete }: H3ExitSealProps) {
  const isReady = draft.gatePhotoDataUrl !== null && Boolean(draft.sealNumberConfirmed?.trim())

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Origin Gate-Out" stepName="Exit Photo & Seal" stepIndex={2} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the exit gate, then confirm the seal number is still intact.
        </p>
        <CameraCapture
          label="Exit gate photo"
          dataUrl={draft.gatePhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ gatePhotoDataUrl: dataUrl })}
        />
        <Input
          label="Confirm seal number"
          placeholder="e.g. FP-1234"
          value={draft.sealNumberConfirmed ?? ''}
          onChange={(e) => onUpdate({ sealNumberConfirmed: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
