// A position fix as a browser reports it. Deliberately NOT driver-pwa's DriverPosition:
// both driver and receiver browsers produce this shape, so a driver-named type would lie
// on half its uses — they're identical only because a geolocation fix is the same thing.
export interface PositionFix {
  lat: number
  lng: number
  /** Metres of horizontal uncertainty, when the platform reports one. */
  accuracyM: number | null
}
