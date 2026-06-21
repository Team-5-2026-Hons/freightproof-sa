// frontend/driver-pwa/components/handshake/steps/H5PodPhoto.tsx
// BLOCKED: BQ2 — physical POD photo vs on-device signature pending Bruce confirmation.
// This screen auto-advances after driver acknowledges. Replace when BQ2 is resolved.
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { Button } from '@/components/ui/Button'

interface H5PodPhotoProps {
  tripId: string
  onComplete: () => void
}

export function H5PodPhoto({ tripId, onComplete }: H5PodPhotoProps) {
  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Photograph POD" stepIndex={4} totalSteps={6} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
        <div className="rounded-xl border-2 border-dashed border-outline-variant p-8 text-center">
          <p className="text-sm font-semibold mb-2">POD capture pending</p>
          <p className="text-xs text-surface-on-variant mb-4">
            Physical vs on-device signature method is pending confirmation (BQ2).
            This step will be fully implemented once the method is confirmed.
          </p>
          <p className="text-xs text-tertiary font-medium">Blocked: BQ2</p>
        </div>
      </div>
      <div className="p-6">
        <Button size="lg" onClick={onComplete}>
          Continue (BQ2 pending)
        </Button>
      </div>
    </main>
  )
}
