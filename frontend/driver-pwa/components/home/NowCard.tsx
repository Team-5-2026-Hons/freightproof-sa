'use client'

import { ChevronRight } from 'lucide-react'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException } from '@shared/lib/types/exception'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, isDriving, phaseLocation } from '@/lib/phase'
import { useTripPlaces } from '@/lib/hooks/useTripPlaces'
import { formatDateTime, formatTime } from '@/lib/utils/format-time'
import { cn } from '@/lib/utils'
import { ExceptionCard } from '@/components/trip/ExceptionCard'

interface NowCardProps {
  trip: Trip
  /** Open exceptions the driver should see (openDriverExceptions) — the badge's reason. */
  exceptions: readonly TripException[]
  onStartPhase: (phase: PhaseDescriptor) => void
  onContinueDriving: () => void
  onViewTrip: () => void
}

// The card's one action: a white capsule on the ink card.
const CARD_ACTION = 'flex min-h-[52px] w-full items-center justify-center rounded-full bg-primary-on text-body font-semibold text-primary transition-transform duration-100 active:scale-[0.98]'

function Exceptions({ exceptions }: { exceptions: readonly TripException[] }) {
  // Every reason the Home tab can be badged, on the screen the badge leads to.
  if (exceptions.length === 0) return null
  return (
    <section aria-label="Open exceptions" className="flex flex-col gap-2">
      {exceptions.map((exc) => <ExceptionCard key={exc.id} exception={exc} />)}
    </section>
  )
}

function ViewTrip({ reference, onClick }: { reference: string; onClick: () => void }) {
  // The reference doubles as the way into the full trip: the one string a driver reads
  // to dispatch, now also the door to everything about it.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View trip ${reference}`}
      className="-mr-1 inline-flex min-h-11 items-center gap-0.5 text-footnote tabular-nums text-primary-on/70"
    >
      {reference}
      <ChevronRight aria-hidden className="size-3.5" strokeWidth={2.5} />
    </button>
  )
}

/**
 * Home's "now": what is happening on the trip and the one thing to
 * do next. Three shapes — on hold (amber, no action: any submit while held 409s), assigned
 * but not started (the route and Start Trip), and underway (where it is, how far through,
 * and the next action).
 */
export function NowCard({ trip, exceptions, onStartPhase, onContinueDriving, onViewTrip }: NowCardProps) {
  const places = useTripPlaces(trip)
  const sorted = [...trip.phases].sort((a, b) => a.sequence_number - b.sequence_number)
  const current = currentPhase(sorted)
  const driving = isDriving(sorted)
  const driverPhases = sorted.filter((p) => p.phase_type !== 'trip_creation')
  const position = current === null ? driverPhases.length : driverPhases.indexOf(current) + 1
  const next = current === null ? null : driverPhases[driverPhases.indexOf(current) + 1] ?? null

  if (trip.status === 'exception_hold') {
    return (
      <div className="flex flex-col gap-3">
        <section aria-label="Current trip" className="overflow-hidden rounded-[22px] bg-attention-tint text-attention-ink">
          <div className="px-[18px] pb-4 pt-[18px]">
            <div className="flex flex-wrap items-center gap-x-2">
              <span aria-hidden className="size-2 rounded-full bg-attention" />
              <span className="text-footnote font-bold uppercase tracking-wide text-attention">Trip on hold</span>
              <span className="ml-auto text-footnote tabular-nums text-attention">{trip.trip_reference}</span>
            </div>
            <p className="mt-3 text-title-2">Waiting for dispatch</p>
            <p className="mt-1.5 text-subhead">
              A critical exception was recorded. Your dispatcher is reviewing it. You can carry on once they clear the hold.
            </p>
          </div>
        </section>
        <Exceptions exceptions={exceptions} />
        <button
          type="button"
          onClick={onViewTrip}
          className="flex min-h-[50px] items-center justify-center rounded-full bg-fill text-body font-semibold text-surface-on transition-transform duration-100 active:scale-[0.98]"
        >
          View Trip
        </button>
      </div>
    )
  }

  if (trip.status === 'created') {
    const stops = [
      { label: places.origin, time: trip.planned_departure_at, timeLabel: 'Depart', marker: 'rounded-full border-2 border-primary-on' },
      { label: places.destination, time: trip.planned_arrival_at, timeLabel: 'Due', marker: 'bg-primary-on' },
    ]
    return (
      <div className="flex flex-col gap-3">
        <section aria-label="Next trip" className="rounded-[22px] bg-primary p-[18px] text-primary-on">
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <span className="text-footnote font-semibold uppercase tracking-wide text-primary-on/70">Next trip</span>
            <ViewTrip reference={trip.trip_reference} onClick={onViewTrip} />
          </div>
          <ol aria-label="Route" className="mb-[18px] mt-3 flex flex-col gap-4">
            {stops.map((stop) => (
              <li key={stop.timeLabel} className="grid grid-cols-[16px_1fr_auto] gap-x-3">
                <span aria-hidden className={cn('mt-1.5 size-2.5', stop.marker)} />
                <span className="min-w-0">
                  <span className="block truncate text-title-3">{stop.label.name}</span>
                  {stop.label.detail !== null && <span className="block truncate text-subhead text-primary-on/70">{stop.label.detail}</span>}
                </span>
                {stop.time !== null && (
                  <span className="text-right">
                    <span className="block text-title-3 tabular-nums">{formatTime(stop.time)}</span>
                    <span className="block text-subhead text-primary-on/70">{stop.timeLabel}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {trip.planned_departure_at !== null && (
            <p className="-mt-2 mb-3 text-footnote text-primary-on/70">{formatDateTime(trip.planned_departure_at)}</p>
          )}
          {current !== null && (
            <button type="button" onClick={() => onStartPhase(current)} className={CARD_ACTION}>Start Trip</button>
          )}
        </section>
        <Exceptions exceptions={exceptions} />
      </div>
    )
  }

  const eta = trip.planned_arrival_at === null ? null : formatTime(trip.planned_arrival_at)
  const where = current === null ? null : phaseLocation(sorted, current)
  const heading = current === null ? 'All phases complete' : driving ? places.destination.name : PHASE_NAMES[current.phase_type]
  const context = driving
    ? [places.destination.detail, eta && `ETA ${eta}`].filter(Boolean).join(' · ')
    : where === 'Origin' ? places.origin.name : where === 'Destination' ? places.destination.name : where

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Current trip" className="rounded-[22px] bg-primary px-[18px] pb-4 pt-[18px] text-primary-on">
        {/* Wraps at the large accessibility text sizes rather than pushing the trip
            reference off the card. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-success" />
            <span className="text-footnote font-semibold uppercase tracking-wide">
              {driving ? 'In transit' : current === null ? 'Complete' : 'Underway'}
            </span>
          </span>
          <ViewTrip reference={trip.trip_reference} onClick={onViewTrip} />
        </div>
        <p className="mt-2 text-title-1 tracking-tight">{heading}</p>
        {context && <p className="text-subhead text-primary-on/70">{context}</p>}

        {/* One segment per phase in the plan; the count beside it is the same fact in words. */}
        <div aria-hidden className="mb-1.5 mt-4 grid gap-1" style={{ gridTemplateColumns: `repeat(${driverPhases.length}, minmax(0, 1fr))` }}>
          {driverPhases.map((phase) => {
            const done = phase.status === 'completed' || phase.status === 'overridden'
            const isCurrent = phase.phase_event_id === current?.phase_event_id
            return (
              <span
                key={phase.phase_event_id}
                className={cn('h-1 rounded-full', done ? 'bg-primary-on' : isCurrent ? 'bg-secondary' : 'bg-primary-on/20')}
              />
            )
          })}
        </div>
        <p className="mb-4 text-footnote text-primary-on/70">
          Phase {position} of {driverPhases.length}{next !== null && ` · next, ${PHASE_NAMES[next.phase_type]}`}
        </p>

        {driving ? (
          <button type="button" onClick={onContinueDriving} className={CARD_ACTION}>Continue Driving</button>
        ) : current !== null && (
          <button type="button" onClick={() => onStartPhase(current)} className={CARD_ACTION}>
            Start {PHASE_NAMES[current.phase_type]}
          </button>
        )}
      </section>
      <Exceptions exceptions={exceptions} />
    </div>
  )
}
