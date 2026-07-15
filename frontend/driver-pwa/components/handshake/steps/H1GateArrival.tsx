// frontend/driver-pwa/components/handshake/steps/H1GateArrival.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { GpsCapture } from '@/components/handshake/GpsCapture'
import { HoldButton } from '@/components/handshake/HoldButton'
import { reverseGeocode } from '@/lib/api/geocode'
import type { H1Evidence } from '@/lib/types/evidence-draft'

interface H1GateArrivalProps {
  tripId: string
  draft: H1Evidence
  onUpdate: (patch: Partial<H1Evidence>) => void
  onComplete: () => void
}

export function H1GateArrival({ tripId, draft, onUpdate, onComplete }: H1GateArrivalProps) {
  const hasGps = draft.gpsLat !== null && draft.gpsLng !== null

  function handleGpsCapture(lat: number, lng: number) {
    onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })

    // Fire-and-forget: address is a display-only nice-to-have, must never block
    // the GPS-captured UI state or the Hold-to-confirm button (gated on hasGps alone).
    // reverseGeocode never rejects today, but the no-op catch is a local safety net
    // in case that invariant is ever broken by a future edit to geocode.ts.
    void reverseGeocode(lat, lng)
      .then((address) => {
        if (address !== null) onUpdate({ gateAddress: address })
      })
      .catch(() => {})
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader
        handshakeName="Origin Gate-In"
        stepName="Gate Arrival"
        stepIndex={1}
        totalSteps={2}
      />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Capture your GPS location at the origin gate to record your arrival position.
        </p>
        <GpsCapture captured={hasGps} onCapture={handleGpsCapture} />
        {draft.gateAddress && (
          <p className="text-xs text-surface-on-variant">{draft.gateAddress}</p>
        )}
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Hold to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
