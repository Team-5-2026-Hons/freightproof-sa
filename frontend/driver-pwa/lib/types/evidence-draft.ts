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
//    mechanism — the same shape as lib/hooks/useSealReference.ts (which already solves
//    this for the seal, bridging `departure` -> `unloading`). Building that hook is out
//    of scope here (it belongs to the task that wires the phase step pages); this file
//    only guarantees both fields exist so that wiring has somewhere to read from and
//    write to.

export interface ActivationEvidence {
  gpsLat: number | null
  gpsLng: number | null
  // Populated via Google Geocoding API reverse-lookup of gpsLat/gpsLng — display-only, not sent to a backend yet.
  gateAddress: string | null
  capturedAt: string | null
}

// D11: loading's only driver input is a BLIND visual count — no expected/PP figure is
// ever shown alongside it (F1's fence), so this type deliberately carries nothing to
// display a reference against. The old H2Evidence's gpsLat/gpsLng/ppManifestParcelCount
// are gone: gpsLat/gpsLng were never sent to the backend (LoadingCompleteRequest has no
// GPS fields, and their only UI consumer, H2ArriveBay, is retired — D12), and
// ppManifestParcelCount existed only to render the expected-count reference D11 now
// forbids showing.
export interface LoadingEvidence {
  driverVisualCount: number | null
  capturedAt: string | null
}

// D7/T5: the seal is captured AND guard-confirmed here, both within the same
// `departure` phase (previously split across the old H2 loading and H3 origin_gate_out
// handshakes, which needed lib/hooks/useSealReference.ts to bridge the seal number
// across that gap). Because departure now owns both ends of that comparison in one
// draft, no cross-phase reference is needed for departure's OWN gate; useSealReference
// is still needed downstream, to carry this phase's committed sealNumber forward to
// `unloading`'s reference display (see UnloadingEvidence below).
export interface DepartureEvidence {
  gpsLat: number | null
  gpsLng: number | null
  waybillPhotoDataUrl: string | null
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  // The exit guard's independently re-typed seal number. Optional on the wire
  // (DepartureCompleteRequest.seal_number_confirmed) — free-form on purpose, since a
  // mistyped confirmation is itself evidence of a mismatch and must be recordable.
  sealNumberConfirmed: string | null
  // Device-local three-way indicator computed against sealNumberConfirmed vs
  // sealNumber — mirrors the old H3Evidence field. Never sent directly; it only
  // shapes DepartureCompleteRequest.guard_verified_seal (see lib/api/phases.ts).
  sealVerifiedMatch: boolean | null
  capturedAt: string | null
}

export interface UnloadingEvidence {
  waybillHandedOver: boolean | null
  // The driver's typed seal entry at destination — backend needs the actual value
  // (UnloadingCompleteRequest.seal_number_at_destination), not just whether it matched.
  sealNumberAtDestination: string | null
  // Device-local comparison against the seal carried forward from `departure` (via
  // useSealReference) — purely a UI indicator; the backend does its own authoritative
  // comparison server-side against that leg's committed departure seal.
  sealVerifiedMatch: boolean | null
  sealBrokenPhotoDataUrl: string | null
  // Captured as unloading's last step but has no field on UnloadingCompleteRequest —
  // see this file's header comment. Submitted, once carried forward, as
  // ConfirmationEvidence.driverVisualCount.
  driverVisualCount: number | null
  capturedAt: string | null
}

export interface ConfirmationEvidence {
  // BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
  // signature — both required, not either/or.
  podPhotoDataUrl: string | null
  podSignatureDataUrl: string | null
  // Carried forward from the UnloadingEvidence captured immediately before this phase
  // (see this file's header comment) — this is the value actually submitted as
  // ConfirmationCompleteRequest.driver_visual_count.
  driverVisualCount: number | null
  reconciliationNote: string | null
  capturedAt: string | null
}

export type PhaseEvidence =
  | ActivationEvidence
  | LoadingEvidence
  | DepartureEvidence
  | UnloadingEvidence
  | ConfirmationEvidence
