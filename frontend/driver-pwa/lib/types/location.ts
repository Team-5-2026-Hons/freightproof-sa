// The driver's position as the rest of the app passes it around. Deliberately not part
// of the evidence drafts in lib/types/evidence-draft.ts — the app takes a fix silently,
// so a phase submission can carry it without every draft shape growing coordinate fields.

export interface DriverPosition {
  lat: number
  lng: number
  // Metres of horizontal uncertainty, when the platform reports one.
  accuracyM: number | null
  // Device time at which this exact fix was read. Optional for legacy callers that
  // only render a map; phase preview/submission carries it unchanged as evidence.
  capturedAt?: string
}

/** A driver's acknowledgement of a reliable preview warning, never an assessment override. */
export interface LocationWarningAcknowledgement {
  acknowledgedAt: string
  reason: string
}
