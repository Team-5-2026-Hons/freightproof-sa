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
  const isReady = draft.gpsLat !== null && draft.gatePhotoDataUrl !== null && draft.sealNumberConfirmed !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Origin Gate-Out" stepName="Confirm Departure" stepIndex={3} totalSteps={3} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          You are about to depart. Hold to submit — your departure is recorded and you are now in transit.
        </p>
        <EvidenceReview
          items={[
            { label: 'GPS', value: draft.gpsLat ? `${draft.gpsLat.toFixed(5)}, ${draft.gpsLng?.toFixed(5)}` : null },
            { label: 'Exit photo', value: draft.gatePhotoDataUrl, isImage: true },
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
      <div className="flex justify-center p-6">
        <HoldButton label="Depart" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
