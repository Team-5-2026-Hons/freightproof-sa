'use client'

import type { DriverTripSummary } from '@/lib/types/driver-trip'
import type { Trip } from '@shared/lib/types/trip'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentPhase, isDriving } from '@/lib/phase'
import { formatTime } from '@/lib/utils/format-time'
import { placeOf, placeParts } from '@/lib/utils/trip-display'
import { cn } from '@/lib/utils'

interface ActiveTripCardProps {
  summary: DriverTripSummary
  /** The session trip, when it is this one — it alone carries the phase plan. */
  trip: Trip | null
  onOpen: () => void
}

/**
 * The trip underway, pinned at the top of Trips: an ink card — the one
 * dark object on a white page, so "now" is found before anything else is read.
 */
export function ActiveTripCard({ summary, trip, onOpen }: ActiveTripCardProps) {
  const origin = placeParts(placeOf(summary.origin_precinct_name, summary.origin_precinct_id)).name
  const destination = placeParts(placeOf(summary.destination_precinct_name, summary.destination_precinct_id)).name
  const onHold = summary.status === 'exception_hold'

  const phases = trip !== null && trip.id === summary.id
    ? [...trip.phases].sort((a, b) => a.sequence_number - b.sequence_number)
    : null
  const driverPhases = phases?.filter((p) => p.phase_type !== 'trip_creation') ?? null
  const current = phases === null ? null : currentPhase(phases)
  const status = onHold
    ? 'On hold'
    : phases !== null && isDriving(phases) ? 'In transit'
    : current !== null ? PHASE_NAMES[current.phase_type] : 'Underway'
  const position = driverPhases !== null && current !== null
    ? `Phase ${driverPhases.indexOf(current) + 1} of ${driverPhases.length}`
    : null
  const eta = summary.planned_arrival_at === null ? null : formatTime(summary.planned_arrival_at)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Current trip, ${origin} → ${destination}`}
      className="mx-4 flex flex-col gap-2.5 rounded-[22px] bg-primary px-[18px] py-4 text-left text-primary-on transition-transform duration-150 active:scale-[0.99]"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span aria-hidden className={cn('size-2 rounded-full', onHold ? 'bg-attention' : 'bg-success')} />
          <span className="text-footnote font-semibold uppercase tracking-wide">{status}</span>
        </span>
        <span className="text-footnote tabular-nums text-primary-on/70">{summary.trip_reference}</span>
      </span>
      <span className="flex items-end justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-title-2">{`${origin} → ${destination}`}</span>
          {position !== null && <span className="block text-subhead text-primary-on/70">{position}</span>}
        </span>
        {eta !== null && (
          <span className="shrink-0 text-right">
            <span className="block text-footnote text-primary-on/70">ETA</span>
            <span className="block text-title-2 tabular-nums">{eta}</span>
          </span>
        )}
      </span>
    </button>
  )
}
