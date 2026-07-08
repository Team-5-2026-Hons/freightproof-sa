// frontend/driver-pwa/components/handshake/steps/H4ApproachDest.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H4Evidence } from '@/lib/types/evidence-draft'

interface H4ApproachDestProps {
  tripId: string
  draft: H4Evidence
  onUpdate: (patch: Partial<H4Evidence>) => void
  onComplete: () => void
}

export function H4ApproachDest({ tripId, draft, onUpdate, onComplete }: H4ApproachDestProps) {
  const hasGps = draft.gpsLat !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Destination Gate-In" stepName="Destination Gate Arrival" stepIndex={1} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          You have arrived at the destination. Capture your GPS location.
        </p>
        <GpsCapture captured={hasGps} onCapture={(lat, lng) => onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })} />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
