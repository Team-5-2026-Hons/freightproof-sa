// frontend/driver-pwa/lib/api/phases.ts
//
// Replaces lib/api/handshakes.ts + the completeH1..completeH5 routes it called
// (lib/api/trips.ts) — those five /handshakes/h{n}/complete endpoints are deleted
// server-side. One endpoint now: POST /trips/{id}/phases/{phase_event_id}/complete,
// which returns the trip's full updated TripDetailResponse (not just the phase), so
// the client gets the refreshed plan back in the same round trip.
import { api } from './client'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseStatus, PhaseType } from '@shared/lib/types/phase'
import type {
  ConfirmationEvidence, DepartureEvidence,
  LoadingEvidence, PhaseEvidence, UnloadingEvidence,
} from '@/lib/types/evidence-draft'
import type { DriverPosition } from '@/lib/types/location'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { uploadArtifact, type ArtifactType } from './artifacts'

// Every variant carries idempotency_key — the offline-queue entry id (or an
// online-path equivalent generated the same way, see submitPhase below), so a
// resubmitted completion returns the current state instead of duplicating evidence.
interface PhaseCompleteRequestBase {
  idempotency_key: string
}

// Mirrors backend schemas/phases.py's ActivationCompleteRequest..ConfirmationCompleteRequest
// exactly, discriminated on phase_type like the backend's own Pydantic union. Each
// phase_type is pinned to `Extract<PhaseType, '...'>` rather than a bare string literal
// so that if the shared PhaseType union ever drops or renames one of these five members,
// this file fails to compile instead of silently drifting from the wire contract.
export interface ActivationCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'activation'>
  driver_phone_lat: number
  driver_phone_lng: number
}

// No driver_visual_count. The warehouse scan (not a driver-entered figure) is what
// records what was loaded now — the server derives parcel_count_origin from it
// (orchestration/phase_gate.py). The field is still ACCEPTED server-side as Optional
// purely so a pre-existing offline-queue entry can drain; this app no longer sends it.
export interface LoadingCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'loading'>
  // The photographed paper linehaul sheet. Optional on the wire (Task 13) — a paperless
  // warehouse hands the driver nothing to photograph, and this must never block
  // completion. Always sent explicitly (null when there is no photo) rather than
  // omitted, so a failed early upload can never silently drop a captured photo.
  linehaul_photo_artifact_id: string | null
}

// No guard_verified_seal and no seal_number_confirmed. Both are still ACCEPTED by the
// backend (DepartureCompleteRequest.guard_verified_seal is Optional[bool], so older
// builds and replayed offline-queue entries don't 422), but this app no longer collects
// either: guards have no accounts, and the step that asked one to re-type the driver's
// seal number on the driver's own phone was removed 2026-08-05. Omitting the boolean is
// what tells the server "no independent confirmation was collected" — sending `false`
// would have it record a CRITICAL seal_mismatch on every trip.
export interface DepartureCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'departure'>
  waybill_photo_artifact_id: string
  seal_number: string
  seal_photo_artifact_id: string
}

// Arrival. Mirrors backend schemas/phases.py's InTransitCompleteRequest, which is
// _PhaseCompleteBase and nothing more: no photo, no artifact id, no seal. The driver's
// swipe on the in-transit hub means "I am here", and when + where is the whole record.
export interface InTransitCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'in_transit'>
}

export interface UnloadingCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'unloading'>
  seal_number_at_destination: string
  // The seal as found at destination, intact, before the warehouse breaks it — required,
  // not optional, and named for the PhaseEvent column it reuses rather than for what it
  // depicts (see UnloadingEvidence.sealIntactPhotoDataUrl). Omitting it 422s.
  gate_photo_artifact_id: string
}

export interface ConfirmationCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'confirmation'>
  pod_photo_artifact_id: string
  pod_signature_artifact_id: string
  // Recorded and anchored as evidence; never compared against a parcel count client-side
  // (design §5, backend schemas/phases.py's own comment on this field). Optional
  // (2026-08-08): the driver may leave unloading's count blank, in which case the
  // carried-forward value is null — never coerced to 0. Pallet-grain evidence, not a
  // completion gate.
  driver_visual_count: number | null
  // No pp_scan_in_count. It used to carry the driver's own driver_visual_count a second
  // time under a different key, which made the backend's reconciliation compare a number
  // against itself — the field is gone from ConfirmationCompleteRequest server-side; the
  // server now derives it from Parcel.pp_scan_in_at. The identically-named key in the
  // anchored canonical payload is unrelated to this request field and is rebuilt
  // server-side, not sent by the client.
}

// trip_creation is deliberately absent — schemas/phases.py's own union has no variant for
// it (create_trip writes that row before a driver is involved); addressing it 422s
// server-side by design. in_transit JOINED this union on 2026-08-09: arrival is now an
// explicit driver attestation submitted from the in-transit hub's swipe, not a side
// effect of advance_unloading.
export type PhaseCompleteRequest =
  | ActivationCompleteRequest
  | LoadingCompleteRequest
  | DepartureCompleteRequest
  | InTransitCompleteRequest
  | UnloadingCompleteRequest
  | ConfirmationCompleteRequest

// H2/H5 anchored to Hedera HCS server-side with a 15s submit budget (~9s measured
// live) under the old model; departure and confirmation anchor the same way now (D7).
// This must exceed the server's own anchor budget plus DB write/refetch margin, or the
// client aborts a submit the server then completes anyway — the offline queue then
// retries it and the backend's idempotency gate short-circuits the duplicate as a 200,
// which is harmless but wastes a retry cycle the client could have avoided.
const PHASE_SUBMIT_TIMEOUT_MS = 30_000

// Raw endpoint call. Always 200 on success, INCLUDING when the phase records a mismatch
// (evidence, not a client error) and INCLUDING when its Hedera anchor failed (fail-open,
// D7) — callers must read the returned phase's own status/anchor_status, never treat a
// 200 alone as an unqualified clean result. 404 trip/phase not found; 409 on a closed/
// held trip, an unresolved earlier phase, or a phase_type that doesn't match the
// addressed row (PhaseSequenceError / PhaseTypeMismatchError server-side).
export const completePhase = (
  tripId: string,
  phaseEventId: string,
  request: PhaseCompleteRequest,
): Promise<Trip> =>
  api.post<Trip>(
    `/api/v1/trips/${tripId}/phases/${phaseEventId}/complete`,
    request,
    { timeoutMs: PHASE_SUBMIT_TIMEOUT_MS },
  )

// Spreads the fix onto a completion body, or contributes nothing when there isn't one.
// Omitting the keys (rather than sending nulls) is what keeps a failed capture from
// overwriting a position an earlier attempt of this same submission already stored —
// the backend's _record_driver_position only writes when both arrive.
function driverPosition(position: DriverPosition | null): {
  driver_phone_lat?: number
  driver_phone_lng?: number
} {
  if (position === null) return {}
  return { driver_phone_lat: position.lat, driver_phone_lng: position.lng }
}

// Resolves the artifact id for one captured photo: the id the early upload already
// produced (lib/hooks/useArtifactUpload.ts, started when the driver took the shot), or
// an upload right now if that never landed — offline at capture, or a failed request.
// The fallback is what keeps "upload early" a pure optimisation: no path can reach the
// server without the photo.
async function artifactIdFor(
  tripId: string, artifactType: ArtifactType, readyId: string | null,
  dataUrl: string, capturedAt: string,
): Promise<string> {
  if (readyId !== null) return readyId
  const uploaded = await uploadArtifact({ tripId, artifactType, dataUrl, capturedAt })
  return uploaded.id
}

export interface SubmitPhaseResult {
  ok: boolean
  // The backend's updated TripDetail from the complete call. Null in demo mode (no
  // backend call happened) — mirrors the old SubmitHandshakeResult's reasoning: after
  // the trip's last phase this is the only response that still carries that phase's
  // receipt id, since a refetch of /trips/me/active returns null once the trip closes.
  trip: Trip | null
  // The addressed phase's OWN status, read off `trip.phases` after the call — not
  // assumed. `_gate_and_load`'s server-side dedupe (phase_service.py:108-134)
  // short-circuits a replay of an already-resolved phase and still returns 200 with the
  // current trip, so `ok: true` alone never proves this call did fresh work. Callers
  // (the offline queue, step pages) must read this field instead of inferring success
  // from the HTTP outcome. Null only if the addressed phase is somehow missing from the
  // returned plan — defensive, should not happen against a healthy backend.
  phaseStatus: PhaseStatus | null
}

// Demo mode: IS_DEMO_MODE (NEXT_PUBLIC_DEMO_MODE=true/unset) returns a mock success
// immediately — same short-circuit lib/api/handshakes.ts's submitHandshake had.
// Production: uploads any captured photos as evidence artifacts, then calls
// completePhase() with the resulting artifact ids.
//
// `idempotencyKey` is a required, caller-supplied value — NOT generated in here — so
// that a retried logical submission (whether replayed from the offline queue, whose
// entry.id is generated once at enqueue time and never changes, or retried directly by
// an online caller) always sends the SAME key. Task 5.3: online (non-queued) callers
// must generate theirs with `crypto.randomUUID()` too, once per logical submission
// attempt and reused across its own retries, so the online and replay paths are
// identical from the server's point of view.
//
// `position` is the driver's phone fix, taken silently by the caller at submit time
// (lib/context/LocationContext.tsx) — there is no longer a step that asks the driver to
// capture one. It rides on the wire for EVERY phase, because phase_events has always had
// driver_phone_lat/lng on every row and the backend now persists them for every phase.
// Null is legal and normal (a warehouse roof, a denied permission) and never blocks a
// submission — except for activation, whose origin-gate position the backend requires.
export async function submitPhase(
  tripId: string,
  phaseEventId: string,
  phaseType: PhaseType,
  evidence: PhaseEvidence,
  idempotencyKey: string,
  position: DriverPosition | null,
): Promise<SubmitPhaseResult> {
  if (IS_DEMO_MODE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    return { ok: true, trip: null, phaseStatus: 'completed' }
  }

  // Every evidence draft carries capturedAt (lib/types/evidence-draft.ts) — safe to
  // read directly off the union without a cast, unlike the old handshakes.ts, which
  // needed one because HandshakeEvidence's members didn't all share it as cleanly.
  const capturedAt = evidence.capturedAt ?? new Date().toISOString()

  let updatedTrip: Trip

  switch (phaseType) {
    case 'activation': {
      // The one phase that cannot proceed without a fix: activation records WHERE the
      // trip started, and ActivationCompleteRequest makes the coordinates required. The
      // message tells the driver what to do about it, because the only remedy is
      // physical (move to open sky) or in the OS settings.
      if (position === null) {
        throw new Error(
          'Could not get your location. Move to open sky, check that Location is enabled for this app, and swipe again.',
        )
      }
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'activation',
        driver_phone_lat: position.lat,
        driver_phone_lng: position.lng,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'loading': {
      // The warehouse scan (not a driver-entered figure) is what records what was
      // loaded — the server derives parcel_count_origin from it. driver_visual_count is
      // still ACCEPTED by the backend (Optional) purely so a pre-existing offline-queue
      // entry can drain; nothing sends it any more.
      //
      // The linehaul photo IS sent, but optionally: resolved via artifactIdFor only when
      // a photo was actually captured, otherwise explicitly null. Reading only
      // e.linehaulPhotoArtifactId here would silently drop the photo whenever its early
      // upload failed (useArtifactUpload's fire-and-forget), instead of falling back to
      // the submit-time upload every other captured photo in this file gets.
      const e = evidence as LoadingEvidence
      const linehaulPhotoId = e.linehaulPhotoDataUrl !== null
        ? await artifactIdFor(tripId, 'photo', e.linehaulPhotoArtifactId, e.linehaulPhotoDataUrl, capturedAt)
        : null
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'loading',
        ...driverPosition(position),
        linehaul_photo_artifact_id: linehaulPhotoId,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'departure': {
      const e = evidence as DepartureEvidence
      if (e.waybillPhotoDataUrl === null || e.sealPhotoDataUrl === null || e.sealNumber === null) {
        throw new Error('Departure evidence incomplete — waybill photo, seal photo, and seal number are required.')
      }
      const [waybillPhotoId, sealPhotoId] = await Promise.all([
        artifactIdFor(tripId, 'photo', e.waybillPhotoArtifactId, e.waybillPhotoDataUrl, capturedAt),
        artifactIdFor(tripId, 'photo', e.sealPhotoArtifactId, e.sealPhotoDataUrl, capturedAt),
      ])
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'departure',
        ...driverPosition(position),
        waybill_photo_artifact_id: waybillPhotoId,
        seal_number: e.sealNumber,
        seal_photo_artifact_id: sealPhotoId,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'unloading': {
      const e = evidence as UnloadingEvidence
      // Truthiness, not `=== null`, unlike the other phases here: an unloading queued
      // offline BEFORE this field existed replays from localStorage with the property
      // absent entirely (useOfflineQueue persists the raw draft), and `undefined === null`
      // is false — which would let a stale entry through and send an undefined artifact id.
      if (e.sealNumberAtDestination === null || !e.sealIntactPhotoDataUrl) {
        throw new Error('Unloading evidence incomplete — seal number and intact seal photo are required.')
      }
      const sealIntactPhotoId = await artifactIdFor(
        // Same reason: a stale entry has no artifact id property at all, and artifactIdFor
        // treats any non-null readyId as usable.
        tripId, 'photo', e.sealIntactPhotoArtifactId ?? null, e.sealIntactPhotoDataUrl, capturedAt,
      )
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'unloading',
        ...driverPosition(position),
        seal_number_at_destination: e.sealNumberAtDestination,
        gate_photo_artifact_id: sealIntactPhotoId,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'confirmation': {
      const e = evidence as ConfirmationEvidence
      // No driverVisualCount check: the count is optional evidence now, not a completion
      // gate (2026-08-08) — see UnloadingEvidence.driverVisualCount's comment. Only the
      // POD photo and signature remain required.
      if (e.podPhotoDataUrl === null || !e.podSignatureDataUrl) {
        throw new Error('Confirmation evidence incomplete — POD photo and signature are required.')
      }
      const [podPhotoId, podSignatureId] = await Promise.all([
        artifactIdFor(tripId, 'photo', e.podPhotoArtifactId, e.podPhotoDataUrl, capturedAt),
        artifactIdFor(tripId, 'document', e.podSignatureArtifactId, e.podSignatureDataUrl, capturedAt),
      ])
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'confirmation',
        ...driverPosition(position),
        pod_photo_artifact_id: podPhotoId,
        pod_signature_artifact_id: podSignatureId,
        // `?? null`, not a bare read: a confirmation draft queued offline before this
        // field existed replays with the key missing entirely, not set to null (same
        // class of hazard as unloading's e.sealIntactPhotoArtifactId above) — coalescing
        // keeps the wire value an explicit null rather than an omitted/undefined key
        // either way.
        driver_visual_count: e.driverVisualCount ?? null,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'in_transit': {
      // No evidence read and no artifact upload: the attestation IS the submission. The
      // fix rides along via driverPosition() exactly as it does for every other phase.
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'in_transit',
        ...driverPosition(position),
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'trip_creation':
      // No PhaseCompleteRequest variant server-side — create_trip writes this row before
      // a driver is involved, and addressing it 422s by design. Reaching this branch means
      // a routing bug upstream landed the driver on a phase they can never submit.
      throw new Error(`submitPhase: "${phaseType}" is never completed by a driver action`)
    default: {
      // Exhaustiveness guard: a new PhaseType member fails to compile here instead of
      // silently falling through with no request sent.
      const unreachable: never = phaseType
      throw new Error(`submitPhase: unhandled phase type "${String(unreachable)}"`)
    }
  }

  const addressedPhase = updatedTrip.phases.find((p) => p.phase_event_id === phaseEventId) ?? null
  return { ok: true, trip: updatedTrip, phaseStatus: addressedPhase?.status ?? null }
}
