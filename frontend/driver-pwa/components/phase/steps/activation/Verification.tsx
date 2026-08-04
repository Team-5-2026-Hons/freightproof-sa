// frontend/driver-pwa/components/phase/steps/activation/Verification.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { EvidenceReview } from '@/components/phase/EvidenceReview'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ActivationEvidence } from '@/lib/types/evidence-draft'

interface VerificationProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ActivationEvidence
  onComplete: () => void | Promise<void>
}

export function Verification({ tripId, phase, stepIndex, draft, onComplete }: VerificationProps) {
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
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        {/* activation is a feeder phase — the backend only anchors departure and
            confirmation to Hedera HCS (parent plan D7/ANCHORED_PHASES). This evidence
            still matters: it's what those anchored phases are built on. */}
        <p className="text-sm text-surface-on-variant">
          Review your evidence. Swipe to submit — this records the evidence that
          supports your anchored Departure and Confirmation phases.
        </p>
        <EvidenceReview items={items} />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Submit" onConfirm={onComplete} disabled={!isReady} />
      </div>
    </main>
  )
}
