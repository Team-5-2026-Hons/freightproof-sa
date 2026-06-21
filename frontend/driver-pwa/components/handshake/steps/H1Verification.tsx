// frontend/driver-pwa/components/handshake/steps/H1Verification.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { EvidenceReview } from '@/components/handshake/EvidenceReview'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H1Evidence } from '@/lib/types/evidence-draft'

interface H1VerificationProps {
  tripId: string
  draft: H1Evidence
  onComplete: () => void
}

export function H1Verification({ tripId, draft, onComplete }: H1VerificationProps) {
  const isReady = draft.gpsLat !== null && draft.gatePhotoDataUrl !== null

  // Address is an optional, best-effort field (no key configured yet, or the
  // geocode lookup failed) — omit it entirely rather than showing EvidenceReview's
  // "Missing" state, which would wrongly imply the driver forgot a required step.
  const items = [
    { label: 'GPS location', value: draft.gpsLat ? `${draft.gpsLat.toFixed(5)}, ${draft.gpsLng?.toFixed(5)}` : null },
    ...(draft.gateAddress ? [{ label: 'Address', value: draft.gateAddress }] : []),
    { label: 'Entry photo', value: draft.gatePhotoDataUrl, isImage: true },
  ]

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader
        tripId={tripId}
        handshakeName="Origin Gate-In"
        stepName="Verification"
        stepIndex={3}
        totalSteps={3}
      />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Review your evidence. Hold to submit — this anchors H1 to the blockchain.
        </p>
        <EvidenceReview items={items} />
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Submit H1" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
