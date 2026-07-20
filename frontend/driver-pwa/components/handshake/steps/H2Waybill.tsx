// frontend/driver-pwa/components/handshake/steps/H2Waybill.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { CameraCapture } from '@/components/handshake/CameraCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2WaybillProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2Waybill({ tripId, draft, onUpdate, onComplete }: H2WaybillProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshake={2} step={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Photograph the physical waybill. This becomes the legal evidence copy.
        </p>
        <CameraCapture
          label="Waybill"
          dataUrl={draft.waybillPhotoDataUrl}
          onCapture={(dataUrl) => onUpdate({ waybillPhotoDataUrl: dataUrl })}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!draft.waybillPhotoDataUrl} />
      </div>
    </main>
  )
}
