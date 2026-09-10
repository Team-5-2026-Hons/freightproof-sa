import type { Trip } from '@shared/lib/types/trip'
import type { Precinct } from '@shared/lib/types/precinct'
import { InfoRow } from '@/components/ui/InfoRow'
import { CancelTripAction } from '@/components/domain/CancelTripAction'
import { currentSealNumber } from '@/lib/phase/derive'
import { tripArrival, tripConfirmation, precinctLabel } from '@/lib/phase/trip-detail'
import { fmtFull } from '@shared/lib/utils/datetime'
import { ROUTES } from '@/lib/constants/routes'
import { RecordLink } from '@/components/ui/RecordLink'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { delayMinutes, fmtDelay } from '@/lib/format/schedule'

interface Props { trip: Trip; precincts: Precinct[]; onChanged: () => void; returnTo: string }
export function TripInformation({ trip, precincts, onChanged, returnTo }: Props) {
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
      {[...trip.stops].sort((a, b) => a.sequence - b.sequence).map((stop, i) => <div key={stop.id} className="border-b border-outline-v/20 py-3 text-sm">
        {/* Through to the precinct record: a dispatcher checking a stop usually wants its
            geofence or contact details, which live on that page and nowhere here. */}
        <p className="flex flex-wrap items-center gap-x-1 font-semibold text-on-surf">
          <span>{i + 1}.</span>
          <RecordLink href={withReturnTo(ROUTES.precinctDetail(stop.precinct_id), returnTo)}>
            {precinctLabel(precincts.find(p => p.id === stop.precinct_id))}
          </RecordLink>
        </p>
        {stop.slot_time && <p className="mt-1 text-xs text-on-surf-v">Slot {fmtFull(stop.slot_time)}</p>}
      </div>)}
    </section>
    <CancelTripAction tripId={trip.id} status={trip.status} onCancelled={onChanged} />
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
