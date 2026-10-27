import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import { Disclosure } from '@/components/ui/Disclosure'
import { InfoRow } from '@/components/ui/InfoRow'
import { RECORD_AFFORDANCE } from '@/components/ui/RecordLink'
import { Ic } from '@/components/ui/Ic'
import { currentSealNumber } from '@/lib/phase/derive'
import { tripArrival, tripConfirmation, precinctLabel } from '@/lib/phase/trip-detail'
import { routeSummary, scheduleSummary } from '@/lib/trips/info-summary'
import { fmtFull } from '@shared/lib/utils/datetime'
import { delayMinutes, fmtDelay } from '@/lib/format/schedule'

interface Props {
  trip: Trip; precincts: Precinct[]
  /** Owned by the caller, not this panel: below the dock width this panel renders inside
   *  DetailPanel's own overlay <dialog>, and a modal nested inside another open modal
   *  centers on its ancestor's box instead of the viewport. The caller renders the
   *  precinct preview as a sibling of DetailPanel instead — this panel only raises the
   *  request, never a <dialog> of its own. */
  onOpenPrecinct: (precinct: Precinct) => void
}

/** The first two Info sections. A fragment: the caller stacks every section in one divided list. */
export function TripInformation({ trip, precincts, onOpenPrecinct }: Props) {
  return <>
    <Disclosure id="schedule" title="Schedule & seal" summary={scheduleSummary(trip)} defaultOpen>
      <InfoRow label="Last departure seal" value={currentSealNumber(trip.phases) ?? 'Not recorded'} mono />
      <Schedule label="Departure" planned={trip.planned_departure_at} actual={trip.actual_departure_at} />
      <Schedule label="Arrival" planned={trip.planned_arrival_at} actual={tripArrival(trip)} />
      <InfoRow label="Delivery confirmed" value={tripConfirmation(trip) ? fmtFull(tripConfirmation(trip)) : 'Not recorded'} />
      <InfoRow label={trip.status === 'cancelled' ? 'Cancelled' : 'Closed'} value={trip.closed_at ? fmtFull(trip.closed_at) : 'Not yet'} />
    </Disclosure>
    <Disclosure id="route" title="Route" summary={routeSummary(trip, precincts)}>
      <div data-route-stops>
        {[...trip.stops].sort((a, b) => a.sequence - b.sequence).map((stop, i) => {
          const precinct = precincts.find(p => p.id === stop.precinct_id)
          return <div key={stop.id} className="border-b border-outline-v/20 py-3 text-sm last:border-0">
            <p className="flex flex-wrap items-center gap-x-1 font-semibold text-on-surf">
              <span>{i + 1}.</span>
              {precinct
                ? <button type="button" onClick={() => onOpenPrecinct(precinct)} className={RECORD_AFFORDANCE}>
                    {precinctLabel(precinct)}<Ic n="chev" s={12} aria-hidden />
                  </button>
                : <span>{precinctLabel(precinct)}</span>}
            </p>
            {stop.slot_time && <p className="mt-1 text-xs text-on-surf-v">Slot {fmtFull(stop.slot_time)}</p>}
          </div>
        })}
      </div>
    </Disclosure>
  </>
}

function Schedule({ label, planned, actual }: { label: string; planned: string | null; actual: string | null }) {
  const delay = delayMinutes(planned, actual)
  return <>
    <InfoRow label={`Planned ${label.toLowerCase()}`} value={fmtFull(planned)} />
    <InfoRow label={`Recorded ${label.toLowerCase()}`} value={actual ? fmtFull(actual) : 'Not recorded'} />
    {delay !== null && <p className="pb-2 text-right text-xs text-on-surf-v">{fmtDelay(delay)}</p>}
  </>
}
