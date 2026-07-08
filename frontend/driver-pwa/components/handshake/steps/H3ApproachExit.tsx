// frontend/driver-pwa/components/handshake/steps/H3ApproachExit.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H3Evidence } from '@/lib/types/evidence-draft'

interface H3ApproachExitProps {
  tripId: string
  draft: H3Evidence
  onUpdate: (patch: Partial<H3Evidence>) => void
  onComplete: () => void
}

export function H3ApproachExit({ tripId, draft, onUpdate, onComplete }: H3ApproachExitProps) {
  const hasGps = draft.gpsLat !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Origin Gate-Out" stepName="Approach Exit Gate" stepIndex={1} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Capture your GPS location as you approach the exit gate.
        </p>
        <GpsCapture captured={hasGps} onCapture={(lat, lng) => onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })} />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
