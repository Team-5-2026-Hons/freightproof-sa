// frontend/driver-pwa/components/handshake/steps/H5HandWaybill.tsx
'use client'

import { StepHeader } from '@/components/handshake/StepHeader'
import { HoldButton } from '@/components/handshake/HoldButton'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5HandWaybillProps {
  tripId: string
  draft: H5Evidence
  onUpdate: (patch: Partial<H5Evidence>) => void
  onComplete: () => void
}

export function H5HandWaybill({ tripId, draft, onUpdate, onComplete }: H5HandWaybillProps) {
  function handleConfirm() {
    onUpdate({ waybillHandedOver: true })
    onComplete()
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader handshakeName="Unloading" stepName="Hand Waybill Copy" stepIndex={1} totalSteps={6} />
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 flex flex-col gap-2">
          <p className="text-sm font-semibold">Action required</p>
          <p className="text-sm text-surface-on-variant">
            Hand the physical waybill copy to the warehouse receiver. Once they acknowledge receipt, hold to confirm.
          </p>
        </div>
      </div>
      <div className="flex justify-center px-6 pt-6 pb-safe">
        <HoldButton label="Waybill handed over" onConfirm={handleConfirm} />
      </div>
    </main>
  )
}
