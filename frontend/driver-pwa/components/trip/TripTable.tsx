// frontend/driver-pwa/components/trip/TripTable.tsx
'use client'

import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { Chip } from '@/components/ui/Chip'
import { tripStatusChip } from '@/lib/utils/trip-status-chip'
import { precinctName } from '@/lib/utils/precinct-name'
import { formatDateTime } from '@/lib/utils/format-time'

interface TripTableProps {
  trips: DriverTripSummary[]
  onSelect: (trip: DriverTripSummary) => void
}

function formatDeparture(planned: string | null): string {
  return planned ? formatDateTime(planned) : 'Departure not scheduled'
}

// Prefer the name GET /trips/me resolved server-side; fall back to the mock lookup (which
// itself falls back to the id's first characters) so demo-mode rows and any precinct the
// server couldn't resolve still render something identifying rather than a blank arrow.
function precinctLabel(name: string | null, id: string | null): string {
  if (name !== null) return name
  return id !== null ? precinctName(id) : 'Unknown'
}

// One trip = one row. A <button> rather than a click handler on the row div: the whole
// row is the tap target (a driver taps this in a moving cab, so it spans the full width
// and clears 48px on every phone size), and a real button gets keyboard activation and
// focus rings for free instead of hand-rolling them the way Card does.
function TripRow({ trip, onSelect }: { trip: DriverTripSummary; onSelect: () => void }) {
  const { kind, label } = tripStatusChip(trip.status)
  const origin = precinctLabel(trip.origin_precinct_name, trip.origin_precinct_id)
  const destination = precinctLabel(trip.destination_precinct_name, trip.destination_precinct_id)

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={
          'flex w-full items-start gap-3 px-3 py-3 text-left transition-colors duration-150 ' +
          'xs:gap-4 xs:px-4 ' +
          // active: (not just hover:) — a phone has no hover, so without a pressed state
          // a tap gives no feedback at all until the next screen paints.
          'hover:bg-surface-container-low active:bg-surface-container ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
        }
      >
        {/* min-w-0 is what lets the truncate below actually fire: a flex child defaults to
            min-width:auto and refuses to shrink under its content, which is how a long
            precinct name pushes the status chip off a 320px screen. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-[15px] font-semibold leading-tight text-surface-on xs:text-base">
            {trip.trip_reference}
          </p>
          {/* Origin, arrow and destination stay one text node — the route reads as a single
              fact, and splitting it into spans would also break the page-level assertion
              that looks for the whole "A → B" string. */}
          <p className="truncate text-sm leading-tight text-surface-on-variant">
            {origin}
            {' → '}
            {destination}
          </p>
          <p className="truncate text-xs leading-tight text-surface-on-variant sm:hidden">
            {trip.order_number} · {formatDeparture(trip.planned_departure_at)}
          </p>
          {/* From tablet width there is room to give the departure its own right-hand
              column, so the third line here drops back to just the order number. */}
          <p className="hidden truncate text-xs leading-tight text-surface-on-variant sm:block">
            {trip.order_number}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <Chip kind={kind}>{label}</Chip>
          <span className="hidden text-xs text-surface-on-variant sm:block">
            {formatDeparture(trip.planned_departure_at)}
          </span>
        </div>
      </button>
    </li>
  )
}

// The trips list as a table: one framed surface with a column header and hairline-divided
// rows, rather than a stack of detached cards. Cards gave every trip its own elevation and
// its own margin, so ten trips read as ten unrelated objects and cost ~30% more vertical
// space than the same rows do; a driver scanning for one reference wants a register.
export function TripTable({ trips, onSelect }: TripTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/25 bg-surface-container-lowest shadow-ambient-sm">
      {/* Column labels, not content — the rows below are a list, not a <table>, so this
          strip is decorative and hidden from assistive tech, which reads each row's own
          text in order instead. */}
      <div
        className="flex items-center justify-between gap-3 border-b border-outline-variant/25 bg-surface-container-low px-3 py-2 xs:px-4"
        aria-hidden
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant">Trip</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-surface-on-variant">Status</span>
      </div>

      <ul className="divide-y divide-outline-variant/20">
        {trips.map((trip) => (
          <TripRow key={trip.id} trip={trip} onSelect={() => onSelect(trip)} />
        ))}
      </ul>
    </div>
  )
}
