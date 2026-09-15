import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import { InfoRow } from '@/components/ui/InfoRow'
import { RECORD_AFFORDANCE } from '@/components/ui/RecordLink'
import { Ic } from '@/components/ui/Ic'
import { Button } from '@/components/ui/Button'
import { isTripTerminal } from '@/components/domain/CancelTripAction'
import { currentSealNumber } from '@/lib/phase/derive'
import { tripArrival, tripConfirmation, precinctLabel } from '@/lib/phase/trip-detail'
import { fmtFull } from '@shared/lib/utils/datetime'
import { delayMinutes, fmtDelay } from '@/lib/format/schedule'

interface Props {
  trip: Trip; precincts: Precinct[]
  /** Owned by the caller, not this panel: below the dock width this panel renders inside
   *  DetailPanel's own overlay <dialog>, and a modal nested inside another open modal
   *  centers on its ancestor's box instead of the viewport. The caller renders the
   *  precinct preview and the cancellation dialog as siblings of DetailPanel instead —
   *  this panel only raises the request, never a <dialog> of its own. */
  onOpenPrecinct: (precinct: Precinct) => void
  onCancelTrip: () => void
}
export function TripInformation({ trip, precincts, onOpenPrecinct, onCancelTrip }: Props) {
  return <div className="space-y-6">
    {/* Order, driver, phone, horse and trailers used to live here. The header now holds
        all of them permanently on screen and the driver modal holds the phone, so
        repeating them gave a dispatcher the same facts twice with nothing to choose
        between. This panel is the rest of the record. */}
    <section><h3 className="mb-2 text-sm font-bold text-on-surf">Custody</h3>
      <InfoRow label="Last departure seal" value={currentSealNumber(trip.phases) ?? 'Not recorded'} mono />
    </section>
    <section><h3 className="mb-2 text-sm font-bold text-on-surf">Schedule & recorded times</h3>
      <Schedule label="Departure" planned={trip.planned_departure_at} actual={trip.actual_departure_at} />
      <Schedule label="Arrival" planned={trip.planned_arrival_at} actual={tripArrival(trip)} />
      <InfoRow label="Delivery confirmed" value={tripConfirmation(trip) ? fmtFull(tripConfirmation(trip)) : 'Not recorded'} />
      <InfoRow label={trip.status === 'cancelled' ? 'Cancelled' : 'Closed'} value={trip.closed_at ? fmtFull(trip.closed_at) : 'Not yet'} />
    </section>
    <section><h3 className="mb-2 text-sm font-bold text-on-surf">Route</h3>
      {[...trip.stops].sort((a, b) => a.sequence - b.sequence).map((stop, i) => {
        const precinct = precincts.find(p => p.id === stop.precinct_id)
        return <div key={stop.id} className="border-b border-outline-v/20 py-3 text-sm">
          {/* A preview first: a dispatcher checking a stop usually wants its geofence or
              contact details, which live on the precinct record and nowhere here. Openable
              only once the precinct itself has loaded — same rule as the header's vehicles. */}
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
    </section>
    {!isTripTerminal(trip.status) && (
      <Button variant="danger" size="sm" full onClick={onCancelTrip}>
        Cancel trip
      </Button>
    )}
  </div>
}

function Schedule({ label, planned, actual }: { label: string; planned: string | null; actual: string | null }) {
  const delay = delayMinutes(planned, actual)
  return <>
    <InfoRow label={`Planned ${label.toLowerCase()}`} value={fmtFull(planned)} />
    <InfoRow label={`Recorded ${label.toLowerCase()}`} value={actual ? fmtFull(actual) : 'Not recorded'} />
    {delay !== null && <p className="pb-2 text-right text-xs text-on-surf-v">{fmtDelay(delay)}</p>}
  </>
}
