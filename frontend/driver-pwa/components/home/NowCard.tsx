'use client'

import { ArrowRight, ChevronRight, Truck } from 'lucide-react'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, isDriving, phaseLocation } from '@/lib/phase'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { formatTime } from '@/lib/utils/format-time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { HoldNotice } from '@/components/trip/HoldNotice'

interface NowCardProps {
  trip: Trip
  onStartPhase: (phase: PhaseDescriptor) => void
  onContinueDriving: () => void
  onViewTrip: () => void
}

// Home's one job: answer "what do I do now?" in a single glance. The full phase plan
// used to sit here too, which made Home a copy of the trip detail screen (audit H6);
// it now lives one tap away behind "View Trip", and this card carries only what the
// driver needs to act — which phase, where, how far through the trip, and the one action.
export function NowCard({ trip, onStartPhase, onContinueDriving, onViewTrip }: NowCardProps) {
  const sorted = [...trip.phases].sort((a, b) => a.sequence_number - b.sequence_number)
  const current = currentPhase(sorted)
  // isDriving is true only while the ledger's current row is an unresolved in_transit.
  const driving = isDriving(sorted)
  const onHold = trip.status === 'exception_hold'
  const { kind, label } = tripStatusChip(trip.status)

  // trip_creation is the system's phase, finished before the driver is involved — counting
  // it made Home say "Phase 5 of 8" while the timeline's dot for the same phase said 4.
  // Both now count the driver's phases only, so the numbers match on every screen.
  const driverPhases = sorted.filter((p) => p.phase_type !== 'trip_creation')
  const position = current === null ? driverPhases.length : driverPhases.indexOf(current) + 1
  const where = current === null ? null : phaseLocation(sorted, current)
  const eta = trip.planned_arrival_at ? formatTime(trip.planned_arrival_at) : null

  // While driving the useful fact is where the truck is heading and when, not the stop
  // the transit leg departed from.
  const context = driving
    ? [where, eta && `ETA ${eta}`].filter(Boolean).join(' · ')
    : where

  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="Current trip"
        className="flex flex-col gap-4 rounded-3xl bg-surface-container-lowest p-5 shadow-level-2"
      >
        {/* Wraps rather than truncating: at accessibility sizes the reference is the one
            line here a driver may need to read out to dispatch. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="font-mono text-subhead tabular-nums text-surface-on-variant">
            {trip.trip_reference}
          </p>
          <Chip kind={kind} className="shrink-0">{label}</Chip>
        </div>

        <div>
          <h2 className="text-title-1 text-surface-on">
            {current === null ? 'All Phases Complete' : PHASE_NAMES[current.phase_type]}
          </h2>
          {context && <p className="mt-1 text-subhead text-surface-on-variant">{context}</p>}
        </div>

        {/* One segment per phase in the plan: where the trip is, without the list. The
            count beside it is the same fact for anyone who can't read the segments. */}
        <div className="flex items-center gap-3">
          <div className="flex flex-1 gap-1" aria-hidden>
            {driverPhases.map((phase) => {
              const done = phase.status === 'completed' || phase.status === 'overridden'
              const isCurrent = phase.phase_event_id === current?.phase_event_id
              return (
                <span
                  key={phase.phase_event_id}
                  className={cn(
                    'h-1.5 flex-1 rounded-full',
                    done ? 'bg-secondary' : isCurrent ? 'bg-secondary/40' : 'bg-surface-container-highest',
                  )}
                />
              )
            })}
          </div>
          <p className="shrink-0 text-footnote tabular-nums text-surface-on-variant">
            Phase {position} of {driverPhases.length}
          </p>
        </div>

        {/* A held trip must not offer the next phase — any submit while on hold 409s —
            and that outranks driving too: a driver on hold has been told to stop. */}
        {onHold ? (
          <HoldNotice />
        ) : driving ? (
          // While driving, the driving screen IS the primary action — not the arrival
          // phase's capture steps, which can't be completed for hours yet.
          <Button
            size="lg"
            iconLeft={<Truck className="h-5 w-5" strokeWidth={2} aria-hidden />}
            onClick={onContinueDriving}
          >
            Continue Driving
          </Button>
        ) : (
          current !== null && (
            <Button
              size="lg"
              iconRight={<ArrowRight className="h-5 w-5" strokeWidth={2} aria-hidden />}
              onClick={() => onStartPhase(current)}
            >
              Start {PHASE_NAMES[current.phase_type]}
            </Button>
          )
        )}
      </section>

      <button
        type="button"
        onClick={onViewTrip}
        className="flex min-h-[44px] items-center justify-between rounded-2xl px-5 text-body text-secondary transition-opacity duration-100 active:opacity-50"
      >
        View Trip
        <ChevronRight className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      </button>
    </div>
  )
}
