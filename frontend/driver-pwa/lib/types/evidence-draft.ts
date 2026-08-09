// frontend/driver-pwa/lib/types/evidence-draft.ts
//
// Re-keyed by PHASE TYPE (was H1Evidence..H5Evidence, keyed by the old fixed-5
// handshake enum) — mirrors backend schemas/phases.py's five *CompleteRequest
// variants. These are UI-side draft shapes (base64 data URLs, not artifact ids yet);
// lib/api/phases.ts converts each into its wire variant at submit time.
//
// Two real content changes versus the old H1..H5 split, not just a rename:
//
// 1. The seal moves from loading to departure (D7/T5, backend phase_service.py's own
//    comment on advance_departure). DepartureEvidence — not LoadingEvidence — carries
//    sealNumber/sealPhotoDataUrl. This is flagged in the parent plan as the single
//    highest-risk edit in the whole refactor: a stale field left on the wrong type
//    would let a NULL == NULL seal comparison raise nothing and fail no test.
//
// 2. A visual count captured during `unloading` (its last step, per
//    shared/lib/constants/phase-meta.ts STEP_SLUGS.unloading) has no field in the
//    backend's UnloadingCompleteRequest — only `confirmation`'s driver_visual_count
//    carries it on the wire (ConfirmationCompleteRequest.driver_visual_count).
//    UnloadingEvidence.driverVisualCount and ConfirmationEvidence.driverVisualCount are
//    therefore two DIFFERENT fields on two DIFFERENT phase drafts (unloading and
//    confirmation are separate phase_event_id rows, each with its own localStorage
//    draft under usePhaseDraft) that must be bridged by a durable carry-forward
//    mechanism — lib/hooks/useVisualCountCarry.ts, wired in PhaseStepPageClient.tsx.
//    (The seal once had an equivalent bridge, useSealReference; it was deleted with the
//    reference display it fed — see UnloadingEvidence below.) This file only guarantees
//    both fields exist so that wiring has somewhere to read from and write to.

// The driver's position is no longer part of this draft. It used to be captured by a
// dedicated "Gate Arrival" step and stored here until submit; the app now takes the fix
// silently as the phase is confirmed and passes it to submitPhase alongside the evidence
// (lib/types/location.ts, lib/context/LocationContext.tsx). gateAddress went with it —
// it was a display-only reverse-geocode of those coordinates, rendered on the review
// screen of a step that no longer exists.
//
// Activation therefore has no driver-captured evidence of its own left: the phase is the
// act of starting the trip, and the position that proves where it started is attached at
// submit time. The type stays (rather than collapsing to something shared) because
// usePhaseDraft is generic per phase and the backend still has an activation variant.
export interface ActivationEvidence {
  capturedAt: string | null
}

// `loading` has no driver-captured evidence of its own (2026-08-05). The driver's blind
// visual count (D11/F1) is gone with it: the phase is now gated on the warehouse closing
// its scan session (orchestration/phase_gate.py) and closed by the driver confirming the
// linehaul document — a read-only review, not a capture, so it needs nowhere to write a
// value. The old H2Evidence's gpsLat/gpsLng/ppManifestParcelCount were already gone before
// this: gpsLat/gpsLng were never sent to the backend (LoadingCompleteRequest has no GPS
// fields, and their only UI consumer, H2ArriveBay, was retired — D12), and
// ppManifestParcelCount existed only to render an expected-count reference F1 forbids
// showing. The type stays (rather than collapsing to something shared) for the same
// reason ActivationEvidence does — usePhaseDraft is generic per phase and the backend
// still has a loading variant.
// 2026-08-05 (Task 13): one piece of driver-captured evidence returns — a photo of the
// paper linehaul sheet the warehouse hands over. Optional on the wire
// (LoadingCompleteRequest.linehaul_photo_artifact_id), same data-URL/artifact-id pair as
// every other captured photo in this file (see DepartureEvidence's header comment).
export interface LoadingEvidence {
  linehaulPhotoDataUrl: string | null
  linehaulPhotoArtifactId: string | null
  capturedAt: string | null
}

// D7/T5: the seal is captured here, in `departure` (it used to be applied at loading and
// re-confirmed at a separate origin_gate_out handshake). There is no confirmation half
// any more, on this phase or across phases — the guard-confirms-seal step is gone and the
// cross-phase seal carry-forward went with it, so a seal comparison happens in exactly
// one place now: server-side, in advance_unloading.
// Each photo appears TWICE from here on: the data URL the camera produced, and the
// artifact id once it has been uploaded. Uploading starts at capture rather than at
// submit (lib/hooks/useArtifactUpload.ts), so by the time the driver swipes the id is
// usually already there and the submit sends ids only. The data URL is kept regardless —
// it is the fallback lib/api/phases.ts uploads from when the early upload didn't land
// (offline at capture, a failed request), so no path can lose a captured photo.
export interface DepartureEvidence {
  // No gpsLat/gpsLng: the old "Approach Exit Gate" step captured them into this draft
  // and lib/api/phases.ts never sent them — DepartureCompleteRequest had no GPS fields
  // at all. The fix is now taken silently at submit and does reach the server.
  waybillPhotoDataUrl: string | null
  waybillPhotoArtifactId: string | null
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  sealPhotoArtifactId: string | null
  // No sealNumberConfirmed / sealVerifiedMatch (removed 2026-08-05). They held the exit
  // guard's independently re-typed seal number and the device-local comparison against
  // it — the guard-confirms-seal step is gone, because guards have no accounts and a
  // number re-typed on the driver's own phone proves nothing the seal photograph does
  // not. Nothing is sent for them any more: DepartureCompleteRequest.guard_verified_seal
  // is Optional[bool] server-side and omitting it now means "not collected" rather than
  // "guard refused" (backend advance_departure).
  capturedAt: string | null
}

export interface UnloadingEvidence {
  waybillHandedOver: boolean | null
  // The driver's typed seal entry at destination, captured BLIND — backend needs the
  // actual value (UnloadingCompleteRequest.seal_number_at_destination), not a verdict.
  //
  // No sealVerifiedMatch here either (removed 2026-08-05). It held a device-local
  // comparison against a seal carried forward from `departure`, which existed only to
  // drive a match/mismatch banner this step no longer shows — a driver told the expected
  // number has not verified anything. It was never on the wire, and with the carry-
  // forward hook gone nothing could set it to anything but null. advance_unloading does
  // the authoritative comparison server-side against that leg's own departure event and
  // records a CRITICAL seal_mismatch itself, silently.
  sealNumberAtDestination: string | null
  // The seal AS FOUND at destination — intact, before the warehouse breaks it. This is
  // the closing half of the tamper-evidence bookend whose opening half is
  // DepartureEvidence.sealPhotoDataUrl: one photo when the seal is applied, one when it
  // is found. Together they are what proves the trailer was not opened in between.
  //
  // Captured on the `2-seal-verify` step rather than a step of its own, because that is
  // already the moment the driver stands at the intact seal reading its number — and
  // because adding a step would mean editing STEP_SLUGS in shared/, which the dispatcher
  // also reads. Mandatory before that step can be confirmed: once the truck is open the
  // photograph cannot be retaken, so a missed capture is unrecoverable evidence loss.
  //
  // Goes on the wire as UnloadingCompleteRequest.gate_photo_artifact_id — a required
  // UUID, so an unloading submitted without it 422s. The backend name is inherited from
  // the PhaseEvent.gate_photo_artifact_id column it reuses (which was previously unused,
  // hence no migration); it is named for the seal here because that is what it depicts.
  //
  // Two fields for one photo, matching DepartureEvidence's seal/waybill pairs: the data
  // URL the camera produced, and the artifact id once uploaded. Upload starts at capture
  // (lib/hooks/useArtifactUpload.ts), so the id is usually present by the time the driver
  // swipes; the data URL is retained regardless as the submit-time fallback, so no path
  // can lose the photo.
  sealIntactPhotoDataUrl: string | null
  sealIntactPhotoArtifactId: string | null
  // No sealBrokenPhotoDataUrl (removed 2026-08-05, with the '3-seal-break-inspection'
  // step that captured it). It photographed the seal AFTER the warehouse broke it, which
  // says nothing about the journey — the intact photo above is the evidence — and it was
  // never sent: UnloadingCompleteRequest has no field for it and lib/api/phases.ts
  // submits only the intact photo, as gate_photo_artifact_id.
  // Captured as unloading's last step but has no field on UnloadingCompleteRequest —
  // see this file's header comment. Submitted, once carried forward, as
  // ConfirmationEvidence.driverVisualCount.
  //
  // OPTIONAL (2026-08-08): the driver may leave this blank and still confirm the step —
  // the count is a driver-typed observation, not a gate. null means "not counted", not
  // "zero". The step itself still gates on the warehouse's own destination scan
  // (VisualCount.tsx's isBlocked); optional-to-type never means optional-to-wait.
  driverVisualCount: number | null
  capturedAt: string | null
}

export interface ConfirmationEvidence {
  // BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
  // signature — both required, not either/or.
  podPhotoDataUrl: string | null
  podPhotoArtifactId: string | null
  podSignatureDataUrl: string | null
  podSignatureArtifactId: string | null
  // Who signed. A signature with no identifiable signer is the weakest possible proof of
  // delivery — "someone at the warehouse swiped" is not a defence in a disputed-delivery
  // claim. Both values are rendered INTO the attestation PNG
  // (lib/utils/render-attestation.ts), so they are covered by the artifact hash that gets
  // anchored, rather than sitting beside it as mutable metadata.
  //
  // POPIA: an ID number is personal data. It reaches Supabase Storage inside that PNG
  // (af-south-1) and nowhere else — deliberately NOT a ConfirmationCompleteRequest field,
  // so it never enters a phase row, a canonical payload, or a Hedera anchor. It lives in
  // this draft only until the phase submits, at which point clearDraft() removes it from
  // the device alongside the rest of the evidence.
  recipientName: string | null
  recipientIdNumber: string | null
  // Carried forward from the UnloadingEvidence captured immediately before this phase
  // (see this file's header comment) — this is the value actually submitted as
  // ConfirmationCompleteRequest.driver_visual_count.
  //
  // OPTIONAL (2026-08-08): null when the driver left unloading's count blank
  // (useVisualCountCarry seeds this field straight from that draft, so a skipped
  // unloading count carries forward as null here too — never 0, never NaN). Confirmation
  // still submits successfully with it null; ConfirmationCompleteRequest.driver_visual_count
  // is Optional server-side for the same reason.
  driverVisualCount: number | null
  reconciliationNote: string | null
  capturedAt: string | null
}

// Arrival carries no driver-captured evidence at all — capturedAt and nothing else. The
// substance of the attestation is the phone fix, which every phase now attaches at submit
// time (lib/context/LocationContext.tsx) rather than storing in a draft.
//
// The type exists rather than reusing ActivationEvidence because the two are different
// facts that happen to have the same shape today, and because usePhaseDraft is generic
// per phase. There is deliberately no photo field: adding one would make arrival an
// evidence capture, which would need a step recipe, which would mean editing the shared
// STEP_SLUGS contract — the single thing this design was shaped to avoid.
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
