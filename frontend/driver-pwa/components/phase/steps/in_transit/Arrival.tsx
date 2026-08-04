// frontend/driver-pwa/components/phase/steps/in_transit/Arrival.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { GpsCapture } from '@/components/phase/GpsCapture'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

// `in_transit` has no *CompleteRequest variant server-side — it's auto-completed by
// advance_departure's stopgap (parent plan D13, see lib/api/phases.ts's submitPhase,
// which throws if it's ever addressed directly). It also has no entry in
// lib/types/evidence-draft.ts's PhaseEvidence union for the same reason: nothing here is
// ever sent to the backend. This draft shape is local to this component rather than
// imported, because there is nothing upstream to import — it exists only so the GPS
// capture (a real, useful on-device record of arrival position) has somewhere to live
// between capture and whatever the caller (a later task's page client) does with it.
export interface ArrivalDraft {
  gpsLat: number | null
  gpsLng: number | null
  capturedAt: string | null
}

interface ArrivalProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ArrivalDraft
  onUpdate: (patch: Partial<ArrivalDraft>) => void
  onComplete: () => void | Promise<void>
}

export function Arrival({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: ArrivalProps) {
  const hasGps = draft.gpsLat !== null

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <p className="text-sm text-surface-on-variant">
          You have arrived at the destination. Capture your GPS location.
        </p>
        <GpsCapture captured={hasGps} onCapture={(lat, lng) => onUpdate({ gpsLat: lat, gpsLng: lng, capturedAt: new Date().toISOString() })} />
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Swipe to confirm" onConfirm={onComplete} disabled={!hasGps} />
      </div>
    </main>
  )
}
