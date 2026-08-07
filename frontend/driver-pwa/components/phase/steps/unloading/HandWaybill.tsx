// frontend/driver-pwa/components/phase/steps/unloading/HandWaybill.tsx
'use client'

import { StepHeader } from '@/components/phase/StepHeader'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { UnloadingEvidence } from '@/lib/types/evidence-draft'

interface HandWaybillProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: UnloadingEvidence
  onUpdate: (patch: Partial<UnloadingEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function HandWaybill({ tripId, phase, stepIndex, draft, onUpdate, onComplete }: HandWaybillProps) {
  // Mid-phase step today, so onComplete is a plain navigation — returned anyway so this
  // handler stays correct if the step recipe ever reorders and this becomes the last one.
  function handleConfirm(): void | Promise<void> {
    onUpdate({ waybillHandedOver: true })
    return onComplete()
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-2">
          <p className="text-lg font-semibold">Action required</p>
          <p className="text-lg leading-relaxed text-surface-on-variant">
            Hand the physical waybill copy to the warehouse receiver. Once they acknowledge receipt, swipe to confirm.
          </p>
        </div>
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <SwipeToConfirm label="Waybill handed over" onConfirm={handleConfirm} />
      </div>
    </main>
  )
}
