// frontend/driver-pwa/lib/types/location.ts
//
// The driver's position as the rest of the app passes it around. Deliberately NOT part
// of the evidence drafts in lib/types/evidence-draft.ts: those hold what the driver
// captured by hand, and a position is no longer something they capture — the app takes
// it silently. Kept as its own type so a phase submission can carry a fix without every
// draft shape growing a pair of coordinate fields it never sets.

export interface DriverPosition {
  lat: number
  lng: number
  // Metres of horizontal uncertainty, when the platform reports one.
  accuracyM: number | null
}
