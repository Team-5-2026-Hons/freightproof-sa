'use client'

import type { ReactNode } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { useOptionalTrip } from '@/lib/hooks/useOptionalTrip'
import { useTripPlaces } from '@/lib/hooks/useTripPlaces'
import { deliveredSummary } from '@/lib/phase/delivered-summary'
import { isPhaseBlocked } from '@/lib/phase'
import { formatTime } from '@/lib/utils/format-time'
import { cn } from '@/lib/utils'
import type { Trip } from '@shared/lib/types/trip'
import { StepLayout } from '@/components/phase/StepLayout'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { WarehouseWaitAction, WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

interface ClosedProps {
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onComplete: () => void | Promise<void>
}

export function Closed({ phase, stepIndex, draft, onComplete }: ClosedProps) {
  const trip = useOptionalTrip()?.trip ?? null
  const isReady =
    draft.podPhotoDataUrl !== null &&
    Boolean(draft.podSignatureArtifactId)

  const isBlocked = isPhaseBlocked(phase)

  if (isBlocked) {
    return (
      <StepLayout phase={phase} stepIndex={stepIndex} showTitle={false} action={<WarehouseWaitAction />}>
        <WarehouseWaitCard title="Scanning in progress">
          The warehouse is still scanning the parcels in at this stop. The trip will
          close on its own once they finish. Your evidence is saved. No action is
          needed from you.
        </WarehouseWaitCard>
      </StepLayout>
    )
  }

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      showTitle={false}
      requirements={[
        { label: 'Proof of delivery photo', met: draft.podPhotoDataUrl !== null },
        { label: 'Receiver confirmation', met: Boolean(draft.podSignatureArtifactId) },
      ]}
      action={<SwipeToConfirm label="Swipe to Close Trip" onConfirm={onComplete} disabled={!isReady} />}
    >
      <div className="flex flex-col items-center pt-8 text-center">
        <span className="flex size-28 items-center justify-center rounded-full bg-success-tint">
          <span className="flex size-20 items-center justify-center rounded-full bg-success text-success-on">
            <Check className="size-10" strokeWidth={2.6} aria-hidden />
          </span>
        </span>
        <h1 className="mt-6 text-large-title font-extrabold tracking-tight text-surface-on">Delivered</h1>
        <p className="mt-2 text-body text-surface-on-variant">Every phase is on the record. Close the trip to finish.</p>
      </div>
      {trip !== null && <TripFacts trip={trip} />}
    </StepLayout>
  )
}

/** Route, arrival and proof — read from the session trip's own ledger. */
function TripFacts({ trip }: { trip: Trip }) {
  const places = useTripPlaces(trip)
  const { arrivedAt, onTime, anchored, total } = deliveredSummary(trip)
  return (
    <dl className="mt-2 divide-y divide-hairline rounded-[18px] bg-fill px-4">
      <Fact label="Route">{`${places.origin.name} → ${places.destination.name}`}</Fact>
      {arrivedAt !== null && (
        <Fact label="Arrived">
          <span className={cn(onTime === true && 'text-success-ink')}>
            {formatTime(arrivedAt)}
            {onTime !== null && (onTime ? ' · on time' : ' · late')}
          </span>
        </Fact>
      )}
      <Fact label="Proof">
        <span className="inline-flex items-center gap-1.5 text-chain">
          <ShieldCheck className="size-4" strokeWidth={2.4} aria-hidden />
          {anchored} of {total} anchored
        </span>
      </Fact>
    </dl>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 py-2">
      <dt className="shrink-0 text-body text-surface-on-variant">{label}</dt>
      <dd className="min-w-0 break-words text-right text-body font-semibold tabular-nums text-surface-on">{children}</dd>
    </div>
  )
}
