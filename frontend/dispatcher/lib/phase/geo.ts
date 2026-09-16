// Distance maths for comparing a captured GPS fix against a precinct's geofence.
// Pure and unit-tested: a sign error here would silently turn a mismatch into a pass.

export interface Coords {
  lat: number
  lng: number
}

export interface Geofence extends Coords {
  radiusMetres: number
}

const EARTH_RADIUS_METRES = 6_371_008.8

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Great-circle distance in metres between two fixes. */
export function haversineMetres(a: Coords, b: Coords): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const latA = toRadians(a.lat)
  const latB = toRadians(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(h))
}

/** Signed distance from the geofence boundary: negative inside, positive outside. Null
 *  when either input is missing — null is NOT zero, which means "exactly on the boundary". */
export function geofenceOffsetMetres(fix: Coords | null, fence: Geofence | null): number | null {
  if (fix === null || fence === null) return null
  return haversineMetres(fix, fence) - fence.radiusMetres
}

/** Distance between the driver's phone and the horse's GPS — evidence in its own right. */
export function separationMetres(a: Coords | null, b: Coords | null): number | null {
  if (a === null || b === null) return null
  return haversineMetres(a, b)
}

/** Narrow a nullable lat/lng pair into Coords, or null if either half is missing. */
export function toCoords(lat: number | null, lng: number | null): Coords | null {
  if (lat === null || lng === null) return null
  return { lat, lng }
}

// Threshold below which a separation prints as whole metres rather than kilometres.
const METRES_PER_KM = 1_000

/** Whole metres under a kilometre, one decimal of km above it — "0.3 km" reads as
 *  rounding noise when 300 m is the gate-vs-yard distinction that matters. */
export function formatSeparation(metres: number): string {
  if (metres < METRES_PER_KM) return `${Math.round(metres)} m`
  return `${(metres / METRES_PER_KM).toFixed(1)} km`
}
