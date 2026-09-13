// A position fix as a browser reports it, in the shape the attestation renderer draws.
//
// Deliberately NOT driver-pwa's DriverPosition, despite being structurally identical.
// Two surfaces now produce one of these — the driver's phone during a phase, and the
// RECEIVER's browser at handover (FP-155) — and a type named for the driver would be a
// lie on half its uses. driver-pwa keeps DriverPosition for its own trail and hooks; the
// two are the same shape because a browser geolocation fix is the same thing in both
// places, not because either depends on the other.
export interface PositionFix {
  lat: number
  lng: number
  /** Metres of horizontal uncertainty, when the platform reports one. */
  accuracyM: number | null
}
