import { Select } from '@/components/ui/Select'
import { sortTripsForPicker } from '@/lib/dev/demo-stage'
import type { DevTripSummary } from '@/lib/types/dev'

interface TripPickerProps {
  trips: readonly DevTripSummary[]
  tripId: string
  onChange: (tripId: string) => void
}

// Trip picker label: reference, driver, route, phase — enough to pick the right
// trip without opening it first. Every part degrades independently rather than
// hiding the option, since a demo trip may lack a driver or have only one stop.
export function tripOptionLabel(trip: DevTripSummary): string {
  const driver = trip.driver_full_name ?? 'no driver'
  const origin = trip.stops[0]?.precinct_name
  const destination = trip.stops.length > 1 ? trip.stops[trip.stops.length - 1]?.precinct_name : undefined
  const route = origin === undefined ? 'no stops' : destination === undefined ? origin : `${origin} → ${destination}`
  return `${trip.trip_reference} · ${driver} · ${route} · ${trip.current_phase ?? trip.status}`
}

export function TripPicker({ trips, tripId, onChange }: TripPickerProps): React.ReactElement {
  return (
    <Select label="Trip" value={tripId} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a trip…</option>
      {sortTripsForPicker(trips).map((trip) => (
        <option key={trip.trip_id} value={trip.trip_id}>{tripOptionLabel(trip)}</option>
      ))}
    </Select>
  )
}
