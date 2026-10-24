'use client'

import { Check } from 'lucide-react'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { formatTime } from '@/lib/utils/format-time'
import { dayTile, durationLabel, pastOutcome, placeOf, placeParts } from '@/lib/utils/trip-display'
import { cn } from '@/lib/utils'

export type TripRowKind = 'upcoming' | 'past'

const OUTCOME_CLASS = {
  success: 'text-success',
  attention: 'text-attention',
  neutral: 'text-surface-on-variant',
} as const

interface TripRowProps {
  trip: DriverTripSummary
  kind: TripRowKind
  onSelect: () => void
}

/**
 * One trip as a row: a date tile, the route as one fact, then
 * either when it leaves (upcoming) or how it ended (past). One control for the whole row.
 */
export function TripRow({ trip, kind, onSelect }: TripRowProps) {
  const origin = placeParts(placeOf(trip.origin_precinct_name, trip.origin_precinct_id))
  const destination = placeParts(placeOf(trip.destination_precinct_name, trip.destination_precinct_id))
  const tile = dayTile(trip.planned_departure_at)
  const outcome = kind === 'past' ? pastOutcome(trip) : null
  const duration = kind === 'past' ? durationLabel(trip.actual_departure_at, trip.actual_arrival_at) : null

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex min-h-[76px] w-full items-center gap-3.5 px-5 py-3 text-left transition-colors duration-100 active:bg-fill"
    >
      <span aria-hidden className="flex h-[52px] w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-fill">
        <span className="text-[11px] font-semibold leading-tight text-surface-on-variant">{tile?.weekday ?? '—'}</span>
        <span className="text-title-3 font-bold leading-tight tabular-nums text-surface-on">{tile?.day ?? ''}</span>
      </span>
      <span className="min-w-0 flex-1">
        {/* One text node, so the route reads (and is announced) as a single fact. */}
        <span className="block truncate text-headline text-surface-on">{`${origin.name} → ${destination.name}`}</span>
        {outcome === null ? (
          <span className="block truncate text-subhead text-surface-on-variant">
            {trip.planned_departure_at === null
              ? 'Departure not scheduled'
              : [`Departs ${formatTime(trip.planned_departure_at)}`, origin.detail].filter(Boolean).join(' · ')}
          </span>
        ) : (
          <span className={cn('flex items-center gap-1.5 text-subhead', OUTCOME_CLASS[outcome.tone])}>
            {outcome.tone === 'success' && <Check className="size-3.5 shrink-0" strokeWidth={3} aria-hidden />}
            {outcome.tone === 'attention' && <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-attention" />}
            <span className="truncate">{outcome.text}</span>
          </span>
        )}
      </span>
      {duration !== null && <span className="shrink-0 text-subhead tabular-nums text-surface-on-variant">{duration}</span>}
    </button>
  )
}

interface TripListProps {
  trips: readonly DriverTripSummary[]
  kind: TripRowKind
  onSelect: (trip: DriverTripSummary) => void
}

/** Trip rows as a list, with the inset rule between rows that starts under the text. */
export function TripList({ trips, kind, onSelect }: TripListProps) {
  return (
    <ul>
      {trips.map((trip, i) => (
        <li key={trip.id}>
          {/* 20 gutter + 48 tile + 14 gap: the rule starts where the text does. */}
          {i > 0 && <div data-list-rule aria-hidden className="ml-[82px] h-px bg-hairline" />}
          <TripRow trip={trip} kind={kind} onSelect={() => onSelect(trip)} />
        </li>
      ))}
    </ul>
  )
}
