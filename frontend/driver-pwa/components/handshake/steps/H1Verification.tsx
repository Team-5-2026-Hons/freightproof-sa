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
  const isReady = draft.gpsLat !== null

  // Address is an optional, best-effort field (no key configured yet, or the
  // geocode lookup failed) — omit it entirely rather than showing EvidenceReview's
  // "Missing" state, which would wrongly imply the driver forgot a required step.
  const items = [
    // Raw coordinates are noise to a driver — a "Captured" receipt is enough here;
    // the exact lat/lng stays in the draft for the backend payload.
    { label: 'GPS location', value: draft.gpsLat !== null ? 'Captured' : null },
    ...(draft.gateAddress ? [{ label: 'Address', value: draft.gateAddress }] : []),
  ]

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader
        handshakeName="Origin Gate-In"
        stepName="Verification"
        stepIndex={2}
        totalSteps={2}
      />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          {/* H1 is a feeder handshake — the backend only anchors H2 (Loading) and H5
              (Unloading) to Hedera HCS. This evidence still matters: it's what those
              anchored handshakes are built on. */}
          Review your evidence. Hold to submit — this records the evidence that
          supports your anchored Loading and Unloading handshakes.
        </p>
        <EvidenceReview items={items} />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Submit H1" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
