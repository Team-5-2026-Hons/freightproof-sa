'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight, Clock, ShieldCheck, Truck } from 'lucide-react'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, isDriving, phaseLocation } from '@/lib/phase'
import { useTripPlaces } from '@/lib/hooks/useTripPlaces'
import { formatDate, formatDateTime, formatTime } from '@/lib/utils/format-time'
import { durationLabel, pastOutcome, type PlaceParts } from '@/lib/utils/trip-display'
import { cn } from '@/lib/utils'
import { TabSubpage } from '@/components/layout/TabSubpage'
import { Button } from '@/components/ui/Button'
import { RouteRail, type RouteStop } from '@/components/ui/RouteRail'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { StatusBanner } from '@/components/ui/StatusBanner'
import { PhaseList } from '@/components/trip/PhaseList'
import { VehicleSheet } from '@/components/trip/VehicleSheet'

export interface TripDetailViewProps {
  trip: Trip
  onBack: () => void
  onInTransitHub: () => void
  onSelectPhase: (phase: PhaseDescriptor) => void
  showAllPhases: boolean
  notice?: ReactNode
}

const WHAT_YOU_RECORD: Partial<Record<PhaseType, { title: string; detail: string }>> = {
  activation: { title: 'Start trip at the gate', detail: 'One swipe, location recorded' },
  loading: { title: 'Photo of the linehaul sheet', detail: 'After the warehouse loads you' },
  departure: { title: 'Seal number and photo', detail: 'Then swipe to depart' },
}

const MAX_NEXT_NAMES = 3

function bySequence(phases: readonly PhaseDescriptor[]): PhaseDescriptor[] {
  return [...phases].sort((a, b) => a.sequence_number - b.sequence_number)
}

function startsLabel(planned: string | null): string {
  if (planned === null) return 'Departure not scheduled'
  const isToday = new Date(planned).toDateString() === new Date().toDateString()
  return isToday ? `Starts today at ${formatTime(planned)}` : `Starts ${formatDateTime(planned)}`
}

function VehicleRow({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  if (trip.horse === null) {
    return <p className="mx-4 mt-4 rounded-xl bg-fill px-4 py-3 text-subhead text-surface-on-variant">No vehicle assigned yet</p>
  }
  const n = trip.trailers.length
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mx-4 mt-4 flex items-center gap-3.5 rounded-[18px] p-2.5 pr-3.5 text-left ring-1 ring-inset ring-hairline transition-colors duration-100 active:bg-fill"
    >
      <span aria-hidden className="flex h-11 w-14 shrink-0 items-center justify-center rounded-[10px] bg-fill text-surface-on">
        <Truck className="size-6" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-title-3 tabular-nums text-surface-on">{trip.horse.registration}</span>
        <span className="block text-subhead text-surface-on-variant">
          {n === 0 ? 'Truck' : `Truck + ${n} trailer${n === 1 ? '' : 's'}`} · tap for details
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-outline" strokeWidth={2.25} />
    </button>
  )
}

function Band() {
  return <div aria-hidden className="mt-6 h-2 bg-fill" />
}

function routeStops(trip: Trip, places: { origin: PlaceParts; destination: PlaceParts }): RouteStop[] {
  const departed = trip.actual_departure_at
  const arrived = trip.actual_arrival_at
  return [
    {
      id: 'origin',
      eyebrow: departed !== null ? `Departed ${formatTime(departed)}`
        : trip.planned_departure_at !== null ? `Departs ${formatDateTime(trip.planned_departure_at)}` : undefined,
      name: places.origin.name,
      detail: places.origin.detail ?? undefined,
      reached: departed !== null || trip.status !== 'created',
    },
    {
      id: 'destination',
      eyebrow: arrived !== null ? `Arrived ${formatTime(arrived)}`
        : trip.planned_arrival_at !== null ? `Due ${formatTime(trip.planned_arrival_at)}` : undefined,
      name: places.destination.name,
      detail: places.destination.detail ?? undefined,
      reached: arrived !== null,
    },
  ]
}

/**
 * One trip. The status picks the variant: an assignment not yet
 * started shows what it will ask for; a trip underway shows progress, then the route; a
 * finished one is a read-only record. The tab bar stays.
 */
export function TripDetailView({ trip, onBack, onInTransitHub, onSelectPhase, showAllPhases, notice }: TripDetailViewProps) {
  const [allSteps, setAllSteps] = useState(showAllPhases)
  const [vehiclesOpen, setVehiclesOpen] = useState(false)
  const places = useTripPlaces(trip)

  const phases = bySequence(trip.phases)
  const driverPhases = phases.filter((p) => p.phase_type !== 'trip_creation')
  const current = currentPhase(phases)
  const onHold = trip.status === 'exception_hold'
  const driving = isDriving(phases)
  const upcoming = trip.status === 'created'
  const finished = trip.status === 'closed' || trip.status === 'cancelled'

  const title = finished ? 'Trip record' : upcoming ? 'Upcoming trip' : 'Current trip'
  const route = (
    <section aria-labelledby="trip-route" className="mt-6">
      <SectionHeading id="trip-route" title="Route" className="mb-3" />
      <RouteRail stops={routeStops(trip, places)} className="px-5" />
    </section>
  )
  const sheet = <VehicleSheet open={vehiclesOpen} onClose={() => setVehiclesOpen(false)} horse={trip.horse} trailers={trip.trailers} />

  if (finished) {
    const needsReview = trip.exceptions.filter((e) => e.review_status === 'needs_review' && e.severity === 'critical').length
    const outcome = pastOutcome({ ...trip, needs_review_count: needsReview, origin_precinct_name: null, destination_precinct_name: null })
    const duration = durationLabel(trip.actual_departure_at, trip.actual_arrival_at)
    const anchorable = driverPhases.filter((p) => p.anchor_status !== 'not_required')
    const anchored = anchorable.filter((p) => p.anchor_status === 'anchored').length
    const facts = [
      trip.actual_arrival_at && `Arrived ${formatTime(trip.actual_arrival_at)}`,
      trip.planned_arrival_at && `planned ${formatTime(trip.planned_arrival_at)}`,
    ].filter(Boolean).join(', ')
    const closed = trip.closed_at === null ? '' : ` Trip closed ${formatTime(trip.closed_at)}.`
    return (
      <TabSubpage title={title} subtitle={trip.trip_reference} backLabel="Trips" onBack={onBack}>
        <div className="px-5 pt-4">
          <p className="text-subhead text-surface-on-variant">
            {[trip.actual_departure_at && formatDate(trip.actual_departure_at), duration].filter(Boolean).join(' · ')}
          </p>
          <p className="text-title-1 tracking-tight text-surface-on">{`${places.origin.name} → ${places.destination.name}`}</p>
        </div>
        <StatusBanner
          tone={outcome.tone === 'success' ? 'success' : outcome.tone === 'attention' ? 'attention' : 'neutral'}
          title={outcome.text}
          className="mx-4 mt-4"
        >
          {facts === '' ? undefined : `${facts}.${closed}`}
        </StatusBanner>
        <Band />
        <section aria-labelledby="trip-timeline" className="mt-5">
          <SectionHeading id="trip-timeline" title="Timeline" className="mb-1" />
          <PhaseList phases={phases} showTimes />
        </section>
        {anchorable.length > 0 && (
          <div className="mt-4 flex items-center gap-4 px-5">
            <ShieldCheck aria-hidden className="size-6 shrink-0 text-chain" strokeWidth={1.9} />
            <div>
              <p className="text-headline text-surface-on">{anchored} of {anchorable.length} phases anchored</p>
              <p className="text-subhead text-surface-on-variant">Tamper-evident on Hedera</p>
            </div>
          </div>
        )}
        {sheet}
      </TabSubpage>
    )
  }

  if (upcoming) {
    const toRecord = phases
      .slice(0, Math.max(0, phases.findIndex((p) => p.phase_type === 'in_transit')))
      .map((p) => WHAT_YOU_RECORD[p.phase_type])
      .filter((item): item is { title: string; detail: string } => item !== undefined)
    return (
      <TabSubpage
        title={title}
        subtitle={trip.trip_reference}
        backLabel="Trips"
        onBack={onBack}
        action={current === null ? undefined : (
          <Button size="pill" className="shadow-level-5" onClick={() => onSelectPhase(current)}>Start Trip</Button>
        )}
      >
        <VehicleRow trip={trip} onOpen={() => setVehiclesOpen(true)} />
        {notice !== undefined && <div className="mx-4 mt-4">{notice}</div>}
        <StatusBanner
          tone="neutral"
          title={startsLabel(trip.planned_departure_at)}
          icon={<Clock aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2} />}
          className="mx-4 mt-4"
        >
          {`Start the trip when you’re at the ${places.origin.name} gate.`}
        </StatusBanner>
        {route}
        {toRecord.length > 0 && (
          <section aria-labelledby="trip-record-ahead" className="mt-6">
            <SectionHeading id="trip-record-ahead" title="What you’ll record" />
            <ol className="mt-1">
              {toRecord.map((item, i) => (
                <li key={item.title} className="flex min-h-[60px] items-center gap-3.5 px-5 py-2">
                  <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-footnote font-bold">{i + 1}</span>
                  <span>
                    <span className="block text-body text-surface-on">{item.title}</span>
                    <span className="block text-subhead text-surface-on-variant">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
        {sheet}
      </TabSubpage>
    )
  }

  const position = current === null ? driverPhases.length : driverPhases.indexOf(current) + 1
  const nextNames = current === null ? [] : driverPhases
    .slice(driverPhases.indexOf(current) + 1)
    .map((p) => PHASE_NAMES[p.phase_type])
    .slice(0, MAX_NEXT_NAMES)
  const where = current === null ? null : phaseLocation(phases, current)

  const action = onHold ? undefined
    : driving ? <Button size="pill" className="shadow-level-5" onClick={onInTransitHub}>Continue Driving</Button>
    : current !== null ? (
      <Button size="pill" className="shadow-level-5" onClick={() => onSelectPhase(current)}>
        Start {PHASE_NAMES[current.phase_type]}
      </Button>
    ) : undefined

  const banner = onHold ? (
    <StatusBanner tone="attention" title="Trip on hold">
      A critical exception was recorded. Follow your dispatcher’s instructions. Nothing more can be recorded until the hold is cleared.
    </StatusBanner>
  ) : driving ? (
    <StatusBanner tone="success" title="In transit">{`Swipe Arrive when you reach ${places.destination.name}.`}</StatusBanner>
  ) : current === null ? (
    <StatusBanner tone="success" title="All phases complete">Everything on this trip is recorded.</StatusBanner>
  ) : (current.blocked_on ?? null) !== null ? (
    <StatusBanner tone="attention" title={`${PHASE_NAMES[current.phase_type]}: waiting on the warehouse`}>
      It unlocks on its own when they finish.
    </StatusBanner>
  ) : (
    <StatusBanner tone="neutral" title={`${PHASE_NAMES[current.phase_type]} next`}>{where === null ? undefined : `At ${where}`}</StatusBanner>
  )

  return (
    <TabSubpage title={title} subtitle={trip.trip_reference} backLabel="Trips" onBack={onBack} action={action}>
      <VehicleRow trip={trip} onOpen={() => setVehiclesOpen(true)} />
      {notice !== undefined && <div className="mx-4 mt-4">{notice}</div>}
      <div className="mx-4 mt-4">{banner}</div>
      <Band />

      <section aria-labelledby="trip-progress" className="mt-5">
        <SectionHeading id="trip-progress" title="Progress" className="mb-3" />
        <div aria-hidden className="grid gap-1 px-5" style={{ gridTemplateColumns: `repeat(${driverPhases.length}, minmax(0, 1fr))` }}>
          {driverPhases.map((phase) => {
            const done = phase.status === 'completed' || phase.status === 'overridden'
            const isCurrent = phase.phase_event_id === current?.phase_event_id
            return (
              <span
                key={phase.phase_event_id}
                className={cn('h-1.5 rounded-full', done ? 'bg-surface-on' : isCurrent ? 'bg-secondary' : 'bg-surface-container-high')}
              />
            )
          })}
        </div>
        <div className="flex items-center gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-headline text-surface-on">
              Phase {position} of {driverPhases.length}{current !== null && ` · ${PHASE_NAMES[current.phase_type]}`}
            </p>
            {nextNames.length > 0 && <p className="text-subhead text-surface-on-variant">Next: {nextNames.join(', ')}</p>}
          </div>
          <Button variant="fill" size="pill-sm" aria-expanded={allSteps} onClick={() => setAllSteps((open) => !open)}>
            All steps
          </Button>
        </div>
        {allSteps && <PhaseList phases={phases} onSelectCurrent={onHold ? undefined : onSelectPhase} />}
      </section>

      {route}
      {sheet}
    </TabSubpage>
  )
}
