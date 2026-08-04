// frontend/driver-pwa/components/phase/steps/departure/ApproachExit.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { GpsCapture } from '@/components/phase/GpsCapture'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

interface ApproachExitProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: DepartureEvidence
  onUpdate: (patch: Partial<DepartureEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function ApproachExit({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: ApproachExitProps) {
  const hasGps = draft.gpsLat !== null

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          Capture your GPS location as you approach the exit gate.
        </p>
        <GpsCapture captured={hasGps} onCapture={(lat, lng) => onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })} />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Swipe to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
