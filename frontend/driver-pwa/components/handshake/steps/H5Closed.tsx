// frontend/driver-pwa/components/handshake/steps/H5Closed.tsx
'use client'

import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { StepHeader } from '@/components/handshake/StepHeader'
import { HoldButton } from '@/components/handshake/HoldButton'
import { ROUTES } from '@/lib/constants/routes'
import type { H5Evidence } from '@/lib/types/evidence-draft'

interface H5ClosedProps {
  tripId: string
  draft: H5Evidence
  onComplete: () => void
}

export function H5Closed({ tripId, draft, onComplete }: H5ClosedProps) {
  const router = useRouter()
  const isReady =
    draft.waybillHandedOver === true &&
    draft.sealBrokenPhotoDataUrl !== null &&
    draft.driverVisualCount !== null

  function handleClose() {
    onComplete()
    router.replace(ROUTES.trips)
  }

  return (
    <main className="flex min-h-screen flex-col">
      <StepHeader tripId={tripId} handshakeName="Unloading" stepName="Trip Closed" stepIndex={6} totalSteps={6} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-4 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-10 w-10 text-success" strokeWidth={2} aria-hidden />
        </div>
        <div>
          <p className="text-xl font-bold">Trip Complete</p>
          <p className="mt-1 text-sm text-surface-on-variant">
            All five handshakes are done. Evidence has been anchored to Hedera HCS.
          </p>
        </div>
      </div>
      <div className="flex justify-center p-6">
        <HoldButton label="Close trip" onConfirm={handleClose} disabled={!isReady} />
      </div>
    </main>
  )
}
