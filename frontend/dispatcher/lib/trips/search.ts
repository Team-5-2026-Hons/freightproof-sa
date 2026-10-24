import type { PPManifestRef } from '@shared/lib/types/pp-manifest'

/** The fields the dashboard search reads. TripSummary satisfies this. */
export interface SearchableTrip {
  trip_reference: string
  driver: { full_name: string }
  pp_manifest: PPManifestRef | null
}

/** Dashboard filter: the trip reference, the driver's name or the manifest label (client
 *  name, hub and number), ignoring case. A substring match is right for narrowing a live
 *  list. The exact manifest-number match lives server-side, on history and the retry lookup. */
export function matchesTripSearch(trip: SearchableTrip, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return trip.trip_reference.toLowerCase().includes(needle)
    || trip.driver.full_name.toLowerCase().includes(needle)
    || (trip.pp_manifest?.display.toLowerCase().includes(needle) ?? false)
}
