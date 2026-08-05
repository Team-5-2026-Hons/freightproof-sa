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
  ConfirmationEvidence, DepartureEvidence, LoadingEvidence,
  PhaseEvidence, UnloadingEvidence,
} from '@/lib/types/evidence-draft'
import type { DriverPosition } from '@/lib/types/location'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { uploadArtifact } from './artifacts'

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

export interface LoadingCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'loading'>
  driver_visual_count: number
}

export interface DepartureCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'departure'>
  waybill_photo_artifact_id: string
  seal_number: string
  seal_photo_artifact_id: string
  guard_verified_seal: boolean
  // Optional and free-form on the wire — a mistyped confirmation is itself evidence of
  // a mismatch and must be recordable, not withheld for being "wrong".
  seal_number_confirmed?: string
}

export interface UnloadingCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'unloading'>
  seal_number_at_destination: string
}

export interface ConfirmationCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'confirmation'>
  pod_photo_artifact_id: string
  pod_signature_artifact_id: string
  driver_visual_count: number
  pp_scan_in_count: number
}

// trip_creation and in_transit are deliberately absent — schemas/phases.py's own union
// has no variant for either (neither is completed by a driver action); addressing one
// 409s server-side by design (PhaseTypeMismatchError).
export type PhaseCompleteRequest =
  | ActivationCompleteRequest
  | LoadingCompleteRequest
  | DepartureCompleteRequest
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
      const e = evidence as LoadingEvidence
      if (e.driverVisualCount === null) {
        throw new Error('Loading evidence incomplete — visual count is required.')
      }
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'loading',
        ...driverPosition(position),
        driver_visual_count: e.driverVisualCount,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'departure': {
      const e = evidence as DepartureEvidence
      if (e.waybillPhotoDataUrl === null || e.sealPhotoDataUrl === null || e.sealNumber === null) {
        throw new Error('Departure evidence incomplete — waybill photo, seal photo, and seal number are required.')
      }
      const [waybillPhoto, sealPhoto] = await Promise.all([
        uploadArtifact({ tripId, artifactType: 'photo', dataUrl: e.waybillPhotoDataUrl, capturedAt }),
        uploadArtifact({ tripId, artifactType: 'photo', dataUrl: e.sealPhotoDataUrl, capturedAt }),
      ])
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'departure',
        ...driverPosition(position),
        waybill_photo_artifact_id: waybillPhoto.id,
        seal_number: e.sealNumber,
        seal_photo_artifact_id: sealPhoto.id,
        // The boolean is only a fallback: the server compares seal_number_confirmed
        // against THIS SAME request's seal_number (authoritative) whenever it's
        // present. sealVerifiedMatch is computed against a device-local seal reference
        // that can be lost (reinstall, cleared storage) — `e.sealVerifiedMatch ?? false`
        // would send a false "guard did not verify" even though the driver DID confirm
        // a seal. Sending `=== true` only claims verification when it was actually
        // computed (preserves the old H3 fix in lib/api/handshakes.ts).
        guard_verified_seal: e.sealVerifiedMatch === true,
        seal_number_confirmed: e.sealNumberConfirmed?.trim() ? e.sealNumberConfirmed.trim() : undefined,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'unloading': {
      const e = evidence as UnloadingEvidence
      if (e.sealNumberAtDestination === null) {
        throw new Error('Unloading evidence incomplete — seal number is required.')
      }
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'unloading',
        ...driverPosition(position),
        seal_number_at_destination: e.sealNumberAtDestination,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'confirmation': {
      const e = evidence as ConfirmationEvidence
      if (e.podPhotoDataUrl === null || !e.podSignatureDataUrl || e.driverVisualCount === null) {
        throw new Error('Confirmation evidence incomplete — POD photo, signature, and visual count are required.')
      }
      const [podPhoto, podSignature] = await Promise.all([
        uploadArtifact({ tripId, artifactType: 'photo', dataUrl: e.podPhotoDataUrl, capturedAt }),
        uploadArtifact({ tripId, artifactType: 'document', dataUrl: e.podSignatureDataUrl, capturedAt }),
      ])
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'confirmation',
        ...driverPosition(position),
        pod_photo_artifact_id: podPhoto.id,
        pod_signature_artifact_id: podSignature.id,
        driver_visual_count: e.driverVisualCount,
        // pp_scan_in_count isn't captured anywhere in the driver UI (it's the Parcel
        // Perfect scan-in count, not a driver-entered value) — Parcel Perfect
        // integration is out of scope for now, so the driver's own visual count is
        // used as a stand-in. This means confirmation's 3-way reconciliation can never
        // independently catch a mismatch on this leg until a real PP integration
        // lands. Flagged, not hidden (preserves the old H5 caveat).
        pp_scan_in_count: e.driverVisualCount,
        idempotency_key: idempotencyKey,
      })
      break
    }
    case 'trip_creation':
    case 'in_transit':
      // Neither has a PhaseCompleteRequest variant server-side — addressing one 409s
      // by design (trip_creation is written at trip creation; in_transit is
      // auto-completed by advance_departure's stopgap, parent plan D13). Reaching this
      // branch means a routing bug upstream landed the driver on a phase they can never
      // submit — lib/phase/routes.ts's walk should never produce that URL.
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
