// frontend/driver-pwa/components/handshake/steps/H2Review.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { EvidenceReview } from '@/components/handshake/EvidenceReview'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H2Evidence } from '@/lib/types/evidence-draft'

interface H2ReviewProps {
  tripId: string
  draft: H2Evidence
  onComplete: () => void
}

export function H2Review({ tripId, draft, onComplete }: H2ReviewProps) {
  const isReady =
    draft.gpsLat !== null &&
    draft.waybillPhotoDataUrl !== null &&
    Boolean(draft.sealNumber?.trim()) &&
    draft.sealPhotoDataUrl !== null &&
    draft.driverVisualCount !== null

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Loading" stepName="Review & Submit" stepIndex={5} totalSteps={5} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {/* True as of the H2/H5 Hedera anchoring backend work — H2 (Loading) is one of
            only two handshakes the backend actually anchors, so this claim stays. */}
        <p className="text-sm text-surface-on-variant">
          Review all evidence. Hold to submit — H2 will be anchored to Hedera HCS.
        </p>
        <EvidenceReview
          items={[
            // Raw coordinates are noise to a driver — a "Captured" receipt is enough here;
            // the exact lat/lng stays in the draft for the backend payload.
            { label: 'GPS', value: draft.gpsLat !== null ? 'Captured' : null },
            { label: 'PP parcel count', value: draft.ppManifestParcelCount !== null ? String(draft.ppManifestParcelCount) : null },
            { label: 'Your visual count', value: draft.driverVisualCount !== null ? String(draft.driverVisualCount) : null },
            { label: 'Waybill photo', value: draft.waybillPhotoDataUrl, isImage: true },
            { label: 'Seal number', value: draft.sealNumber },
            { label: 'Seal photo', value: draft.sealPhotoDataUrl, isImage: true },
          ]}
        />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Submit H2" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
