// UI-side draft shapes (base64 data URLs, not artifact ids yet) for each phase's
// evidence, keyed by phase type — lib/api/phases.ts converts each to its wire variant.
// UnloadingEvidence.driverVisualCount and ConfirmationEvidence.driverVisualCount are two
// different fields on two different phase drafts, bridged by a durable carry-forward
// mechanism, lib/hooks/useVisualCountCarry.ts (wired in PhaseStepPageClient.tsx).

// No driver-captured evidence: the fix that proves where the trip started is attached
// at submit time (lib/types/location.ts, lib/context/LocationContext.tsx), not stored here.
export interface ActivationEvidence {
  capturedAt: string | null
}

// No blind visual count: the phase is gated on the warehouse closing its scan session
// and closed by the driver confirming the linehaul document — a read-only review.
export interface LoadingEvidence {
  // Optional on the wire (LoadingCompleteRequest.linehaul_photo_artifact_id).
  linehaulPhotoDataUrl: string | null
  linehaulPhotoArtifactId: string | null
  capturedAt: string | null
}

// The seal is captured here, in `departure`. There is no confirmation half any more, on
// this phase or across phases — a comparison happens in exactly one place: server-side,
// in advance_unloading.
//
// Each photo appears twice from here on: the data URL the camera produced, and the
// artifact id once uploaded. Uploading starts at capture (lib/hooks/useArtifactUpload.ts),
// so the id is usually already there by submit; the data URL stays as
// lib/api/phases.ts's fallback for when the early upload didn't land.
export interface DepartureEvidence {
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  sealPhotoArtifactId: string | null
  capturedAt: string | null
}

export interface UnloadingEvidence {
  waybillHandedOver: boolean | null
  // Captured blind — the backend needs the actual value
  // (UnloadingCompleteRequest.seal_number_at_destination), not a verdict.
  // advance_unloading does the authoritative comparison server-side.
  sealNumberAtDestination: string | null
  // Closing half of the tamper-evidence bookend with DepartureEvidence.sealPhotoDataUrl:
  // one photo when the seal is applied, one when found intact. Required — an unloading
  // submitted without it 422s (UnloadingCompleteRequest.gate_photo_artifact_id).
  sealIntactPhotoDataUrl: string | null
  sealIntactPhotoArtifactId: string | null
  // Carried forward to ConfirmationEvidence.driverVisualCount; no field of its own on
  // UnloadingCompleteRequest. Optional — null means "not counted", not "zero"; the step
  // still gates on the warehouse's own destination scan (VisualCount.tsx's isBlocked).
  driverVisualCount: number | null
  capturedAt: string | null
}

export interface ConfirmationEvidence {
  // Proof of delivery requires both a photo and an on-device signature.
  podPhotoDataUrl: string | null
  podPhotoArtifactId: string | null
  // Set from the handover poll (lib/hooks/useRotatingHandover.ts): the attestation PNG is
  // rendered in the receiver's browser and uploaded server-side, never on this device.
  podSignatureArtifactId: string | null
  // Server-stamped instant the receiver confirmed. Display only.
  receiverConfirmedAt: string | null
  // Signer identity is rendered INTO the attestation PNG (lib/utils/render-attestation.ts),
  // not stored as a separate field, so it's covered by the anchored artifact hash. POPIA:
  // an ID number reaches Supabase Storage only inside that PNG, never a phase row or anchor.

  // Carried forward from UnloadingEvidence, captured immediately before this phase.
  // Optional — null when the driver left unloading's count blank.
  driverVisualCount: number | null
  reconciliationNote: string | null
  capturedAt: string | null
}

// No driver-captured evidence: the substance is the phone fix, attached at submit time
// (lib/context/LocationContext.tsx). A separate type from ActivationEvidence only
// because usePhaseDraft is generic per phase.
export interface InTransitEvidence {
  capturedAt: string | null
}

export type PhaseEvidence =
  | ActivationEvidence
  | LoadingEvidence
  | DepartureEvidence
  | InTransitEvidence
  | UnloadingEvidence
  | ConfirmationEvidence
