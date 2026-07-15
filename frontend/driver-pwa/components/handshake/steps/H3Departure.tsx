// frontend/driver-pwa/components/handshake/steps/H3Departure.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { EvidenceReview } from '@/components/handshake/EvidenceReview'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H3Evidence } from '@/lib/types/evidence-draft'

interface H3DepartureProps {
  tripId: string
  draft: H3Evidence
  onComplete: () => void
}

export function H3Departure({ tripId, draft, onComplete }: H3DepartureProps) {
  const isReady = draft.gpsLat !== null && draft.sealNumberConfirmed !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Origin Gate-Out" stepName="Confirm Departure" stepIndex={3} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          You are about to depart. Hold to submit — your departure is recorded and you are now in transit.
        </p>
        <EvidenceReview
          items={[
            // Raw coordinates are noise to a driver — a "Captured" receipt is enough here;
            // the exact lat/lng stays in the draft for the backend payload.
            { label: 'GPS', value: draft.gpsLat !== null ? 'Captured' : null },
            {
              label: 'Seal confirmed',
              value:
                draft.sealNumberConfirmed === null
                  ? null
                  : `${draft.sealNumberConfirmed}${draft.sealVerifiedMatch === false ? ' (mismatch)' : ''}`,
            },
          ]}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Depart" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
