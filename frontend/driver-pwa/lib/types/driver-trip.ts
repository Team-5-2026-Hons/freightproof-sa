// Mirrors backend DriverTripListItemResponse — one row of GET /api/v1/trips/me.
//
// Driver-pwa-local rather than a @shared type: this shape exists only for the driver's
// own trip list. shared/lib/types/trip.ts's TripSummary is the dispatcher board's row
// (it nests driver/horse/trailers, which a driver reading their own list already knows)
// and carries no precinct NAMES, which is the whole reason lib/utils/precinct-name.ts had
// to resolve ids against mock fixtures. This shape carries the names the server resolved.

import type { TripId, TripType } from '@shared/lib/types/trip'
import type { CoarseTripStatus } from '@shared/lib/types/phase'

export interface DriverTripSummary {
  id: TripId
  trip_reference: string
  order_number: string
  // The ONLY field the Active/Upcoming/Past tabs group by. 'created' is an assignment
  // the driver has not activated yet; 'active'/'exception_hold' is underway;
  // 'closed'/'cancelled' is history. See categorizeTrips in lib/utils/trip-filters.ts.
  status: CoarseTripStatus
  trip_type: TripType
  // Both nullable server-side: the Trip model's precinct FKs are nullable, and the
  // name is additionally null if the referenced precinct row has since been deleted.
  origin_precinct_id: string | null
  destination_precinct_id: string | null
  origin_precinct_name: string | null
  destination_precinct_name: string | null
  planned_departure_at: string | null
  actual_departure_at: string | null
  planned_arrival_at: string | null
  actual_arrival_at: string | null
  open_exception_count: number
  created_at: string
  updated_at: string
}
