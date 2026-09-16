// The driver's position as the rest of the app passes it around. Deliberately not part
// of the evidence drafts in lib/types/evidence-draft.ts — the app takes a fix silently,
// so a phase submission can carry it without every draft shape growing coordinate fields.

export interface DriverPosition {
  lat: number
  lng: number
  // Metres of horizontal uncertainty, when the platform reports one.
  accuracyM: number | null
}
