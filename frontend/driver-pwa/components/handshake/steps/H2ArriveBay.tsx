// frontend/driver-pwa/components/handshake/steps/H2ArriveBay.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2ArriveBayProps {
  tripId: string
  draft: H2Evidence
  onUpdate: (patch: Partial<H2Evidence>) => void
  onComplete: () => void
}

export function H2ArriveBay({ tripId, draft, onUpdate, onComplete }: H2ArriveBayProps) {
  const hasGps = draft.gpsLat !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Loading" stepName="Arrive at Bay" stepIndex={1} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Capture your GPS location once you have pulled into the loading bay.
        </p>
        <GpsCapture captured={hasGps} onCapture={(lat, lng) => onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })} />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
