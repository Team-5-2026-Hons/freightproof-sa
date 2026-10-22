import { Capacitor } from '@capacitor/core'
import { mockPrecincts } from '@shared/lib/mocks/precincts'

/**
 * A hand-off to the phone's own map app with directions to a precinct ("Navigate").
 * FreightProof records the drive, it does not route it — this only opens the
 * driver's navigation app at the destination.
 *
 * Coordinates come from the same local precinct lookup as the place names
 * (lib/utils/precinct-name.ts) until the driver's trip payload carries them; an unknown
 * precinct returns null and the caller shows no Navigate control rather than a wrong pin.
 */
export function directionsUrl(precinctId: string): string | null {
  const precinct = mockPrecincts.find((p) => String(p.id) === precinctId)
  if (precinct === undefined) return null
  return coordinateDirectionsUrl(precinct.latitude, precinct.longitude)
}

/**
 * The same hand-off for a point the server named by coordinates — a substitution exchange
 * point, which is not a precinct and so has no entry in the precinct lookup.
 */
export function coordinateDirectionsUrl(latitude: number, longitude: number): string {
  const latLng = `${latitude},${longitude}`
  switch (Capacitor.getPlatform()) {
    case 'android':
      return `google.navigation:q=${latLng}`
    case 'ios':
      return `maps://?daddr=${latLng}&dirflg=d`
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(latLng)}`
  }
}
