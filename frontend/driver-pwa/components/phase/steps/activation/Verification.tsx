'use client'

import { Clock, MapPin, ShieldCheck } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { StepLayout } from '@/components/phase/StepLayout'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { RouteRail } from '@/components/ui/RouteRail'
import { useOptionalTrip } from '@/lib/hooks/useOptionalTrip'
import { useTripPlaces } from '@/lib/hooks/useTripPlaces'
import { cn } from '@/lib/utils'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'

interface VerificationProps {
  phase: PhaseDescriptor
  stepIndex: number
  onComplete: () => void | Promise<void>
}

interface RecordedFact {
  label: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  chain?: boolean
}

const RECORDED: readonly RecordedFact[] = [
  { label: 'Location', Icon: MapPin },
  { label: 'Time', Icon: Clock },
  { label: 'Anchored', Icon: ShieldCheck, chain: true },
]

function TripRoute({ trip }: { trip: Trip }) {
  const places = useTripPlaces(trip)
  return (
    <RouteRail
      stops={[
        { id: 'origin', name: places.origin.name, detail: places.origin.detail ?? undefined, reached: false },
        { id: 'destination', name: places.destination.name, detail: places.destination.detail ?? undefined, reached: false },
      ]}
    />
  )
}

export function Verification({ phase, stepIndex, onComplete }: VerificationProps) {
  const trip = useOptionalTrip()?.trip ?? null

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Swipe at the gate. Where and when you started is recorded as evidence for the rest of the trip."
      action={<SwipeToConfirm label="Swipe to Start Trip" onConfirm={onComplete} />}
    >
      {trip !== null && <TripRoute trip={trip} />}
      <section aria-labelledby="recorded-heading" className="border-t border-hairline pt-5">
        <h2 id="recorded-heading" className="text-subhead font-semibold text-surface-on-variant">Recorded when you swipe</h2>
        <ul className="mt-3 grid grid-cols-3 gap-2.5">
          {RECORDED.map(({ label, Icon, chain }) => (
            <li
              key={label}
              className={cn('rounded-2xl px-3 py-3.5', chain ? 'bg-chain-tint text-chain' : 'bg-fill text-surface-on')}
            >
              <Icon className="size-[22px]" strokeWidth={1.9} aria-hidden />
              <p className="mt-2 text-subhead font-semibold">{label}</p>
            </li>
          ))}
        </ul>
      </section>
    </StepLayout>
  )
}
