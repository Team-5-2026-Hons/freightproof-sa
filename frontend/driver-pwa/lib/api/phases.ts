// One endpoint completes every phase: POST /trips/{id}/phases/{phase_event_id}/complete,
// returning the trip's full updated TripDetailResponse rather than just the phase.
import { api } from './client'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseStatus, PhaseType } from '@shared/lib/types/phase'
import type {
  ConfirmationEvidence, DepartureEvidence,
  LoadingEvidence, PhaseEvidence, UnloadingEvidence,
} from '@/lib/types/evidence-draft'
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'
import type { ActionLocationAssessment, DriverLocationCapture } from '@shared/lib/types/action-location'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { uploadArtifact, type ArtifactType } from './artifacts'

// idempotency_key lets a resubmitted completion return the current state instead of
// duplicating evidence. driver_captured_at is stamped once at submit time and reused on
// replay, never retaken at flush time — see backend schemas/phases.py.
interface PhaseCompleteRequestBase {
  idempotency_key: string
  driver_captured_at: string
  location_warning_acknowledged_at?: string
  location_warning_reason?: string
}

// Mirrors backend schemas/phases.py's discriminated union. `Extract<PhaseType, '...'>`
// fails compilation if the shared PhaseType union ever drops or renames a member here.
export interface ActivationCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'activation'>
  driver_phone_lat: number
  driver_phone_lng: number
}

// No driver_visual_count: the warehouse scan, not a driver figure, records what was
// loaded — the server derives parcel_count_origin from it.
export interface LoadingCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'loading'>
  // Optional — a paperless warehouse has nothing to photograph, so this must never
  // block completion. Sent explicitly as null rather than omitted.
  linehaul_photo_artifact_id: string | null
}

// No guard_verified_seal/seal_number_confirmed: guards have no accounts. Omitting the
// boolean tells the server no independent confirmation was collected — sending `false`
// would record a CRITICAL seal_mismatch on every trip.
export interface DepartureCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'departure'>
  // Normally null — loading's linehaul photo is now the copy of record. Kept optional so
  // a departure queued offline by an older build can still replay with its photo.
  waybill_photo_artifact_id: string | null
  seal_number: string
  seal_photo_artifact_id: string
}

// Lets submitPhase forward a waybill photo from a pre-existing offline-queue entry
// without giving the live DepartureEvidence draft type dead members.
interface LegacyDepartureWaybillPhoto {
  waybillPhotoDataUrl?: string | null
  waybillPhotoArtifactId?: string | null
}

// Arrival attestation only — no photo, artifact id, or seal; when + where is the record.
export interface InTransitCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'in_transit'>
}

export interface UnloadingCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'unloading'>
  seal_number_at_destination: string
  // Seal as found at destination, intact, before the warehouse breaks it. Required —
  // omitting it 422s. Named for the PhaseEvent column it reuses, not what it depicts.
  gate_photo_artifact_id: string
}

export interface ConfirmationCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'confirmation'>
  pod_photo_artifact_id: string
  pod_signature_artifact_id: string
  // Pallet-grain evidence only — never compared against a parcel count client-side.
  // Null, not 0, when unloading's count was left blank.
  driver_visual_count: number | null
  // No pp_scan_in_count: the server derives it from Parcel.pp_scan_in_at, not the client.
}

// trip_creation is deliberately absent: that row is written before a driver is
// involved, and addressing it 422s server-side by design.
export type PhaseCompleteRequest =
  | ActivationCompleteRequest
  | LoadingCompleteRequest
  | DepartureCompleteRequest
  | InTransitCompleteRequest
  | UnloadingCompleteRequest
  | ConfirmationCompleteRequest

// Must exceed the server's Hedera anchor + DB write/refetch budget (~9s measured), or the
// client aborts a submit the server completes anyway; the offline queue then harmlessly
// retries into the backend's idempotency gate.
const PHASE_SUBMIT_TIMEOUT_MS = 30_000
const LOCATION_PREVIEW_TIMEOUT_MS = 5_000

export type { DriverLocationCapture }

export const previewPhaseLocation = (
  tripId: string,
  phaseEventId: string,
  capture: DriverLocationCapture,
): Promise<ActionLocationAssessment> =>
  api.post<ActionLocationAssessment>(
    `/api/v1/trips/${tripId}/phases/${phaseEventId}/location-preview`,
    {
      driver_phone_lat: capture.lat,
      driver_phone_lng: capture.lng,
      driver_captured_at: capture.captured_at,
      driver_accuracy_metres: capture.accuracy_metres,
    },
    { timeoutMs: LOCATION_PREVIEW_TIMEOUT_MS },
  )

// Always 200 on success, including a recorded mismatch (evidence, not an error) or a
// failed Hedera anchor (fail-open) — callers must read the phase's own status/anchor_status,
// not the HTTP code. 404 trip/phase not found; 409 on a closed trip or out-of-sequence phase.
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

// Omits the keys rather than sending nulls, so a failed capture can't overwrite a
// position an earlier attempt of this submission already stored.
function driverPosition(position: DriverPosition | null): {
  driver_phone_lat?: number
  driver_phone_lng?: number
  driver_accuracy_metres?: number
} {
  if (position === null) return {}
  return {
    driver_phone_lat: position.lat,
    driver_phone_lng: position.lng,
    ...(position.accuracyM === null ? {} : { driver_accuracy_metres: position.accuracyM }),
  }
}

function locationWarningAcknowledgement(
  acknowledgement: LocationWarningAcknowledgement | null | undefined,
): Pick<PhaseCompleteRequestBase, 'location_warning_acknowledged_at' | 'location_warning_reason'> {
  if (acknowledgement === null || acknowledgement === undefined) return {}
  return {
    location_warning_acknowledged_at: acknowledgement.acknowledgedAt,
    location_warning_reason: acknowledgement.reason,
  }
}

// Uses the artifact id an early upload already produced (lib/hooks/useArtifactUpload.ts),
// or uploads now if that never landed — offline at capture, or a failed request.
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
  // Null in demo mode. After the trip's last phase, this is the only response that still
  // carries that phase's receipt id, since /trips/me/active returns null once closed.
  trip: Trip | null
  // The addressed phase's own status after the call — a replay of an already-resolved
  // phase still returns 200, so `ok: true` alone doesn't prove fresh work. Null only if
  // the phase is missing from the returned plan (should not happen).
  phaseStatus: PhaseStatus | null
}

// Demo mode returns a mock success immediately. Otherwise uploads any captured photos as
// evidence artifacts, then calls completePhase() with the resulting artifact ids.
//
// `idempotencyKey` must be generated once per logical submission attempt and reused
// across retries (including offline-queue replay), so the server sees the same key.
// `position` is the driver's silent phone fix at submit time; null is legal for every
// phase except activation, which the backend requires. `driverCapturedAt` is stamped
// once per attempt and reused across retries, so a delayed resend still reports the
// original swipe instant.
export async function submitPhase(
  tripId: string,
  phaseEventId: string,
  phaseType: PhaseType,
  evidence: PhaseEvidence,
  idempotencyKey: string,
  position: DriverPosition | null,
  driverCapturedAt: string,
  acknowledgement: LocationWarningAcknowledgement | null = null,
): Promise<SubmitPhaseResult> {
  if (IS_DEMO_MODE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    return { ok: true, trip: null, phaseStatus: 'completed' }
  }

  // Every evidence draft carries capturedAt — safe to read without a cast.
  const capturedAt = evidence.capturedAt ?? new Date().toISOString()
  const acknowledgementFields = locationWarningAcknowledgement(acknowledgement)

  let updatedTrip: Trip

  switch (phaseType) {
    case 'activation': {
      // The one phase that cannot proceed without a fix: it records where the trip started.
      if (position === null) {
        throw new Error(
          'Could not get your location. Move to open sky, check that Location is enabled for this app, and swipe again.',
        )
      }
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'activation',
        driver_phone_lat: position.lat,
        driver_phone_lng: position.lng,
        ...(position.accuracyM === null ? {} : { driver_accuracy_metres: position.accuracyM }),
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      })
      break
    }
    case 'loading': {
      // linehaulPhotoId falls back to a submit-time upload if the early upload never landed.
      const e = evidence as LoadingEvidence
      const linehaulPhotoId = e.linehaulPhotoDataUrl !== null
        ? await artifactIdFor(tripId, 'photo', e.linehaulPhotoArtifactId, e.linehaulPhotoDataUrl, capturedAt)
        : null
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'loading',
        ...driverPosition(position),
        linehaul_photo_artifact_id: linehaulPhotoId,
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      })
      break
    }
    case 'departure': {
      const e = evidence as DepartureEvidence
      if (e.sealPhotoDataUrl === null || e.sealNumber === null) {
        throw new Error('Departure evidence incomplete — seal photo and seal number are required.')
      }
      // Not captured any more, but a pre-existing offline entry may still carry one —
      // forwarded when present rather than dropped.
      const legacy = evidence as LegacyDepartureWaybillPhoto
      const legacyWaybillDataUrl = legacy.waybillPhotoDataUrl ?? null
      const [waybillPhotoId, sealPhotoId] = await Promise.all([
        legacyWaybillDataUrl !== null
          ? artifactIdFor(tripId, 'photo', legacy.waybillPhotoArtifactId ?? null, legacyWaybillDataUrl, capturedAt)
          : Promise.resolve(null),
        artifactIdFor(tripId, 'photo', e.sealPhotoArtifactId, e.sealPhotoDataUrl, capturedAt),
      ])
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'departure',
        ...driverPosition(position),
        waybill_photo_artifact_id: waybillPhotoId,
        seal_number: e.sealNumber,
        seal_photo_artifact_id: sealPhotoId,
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      })
      break
    }
    case 'unloading': {
      const e = evidence as UnloadingEvidence
      // Truthiness, not `=== null`: a stale offline entry may have this property absent
      // entirely, and `undefined === null` is false.
      if (e.sealNumberAtDestination === null || !e.sealIntactPhotoDataUrl) {
        throw new Error('Unloading evidence incomplete — seal number and intact seal photo are required.')
      }
      const sealIntactPhotoId = await artifactIdFor(
        tripId, 'photo', e.sealIntactPhotoArtifactId ?? null, e.sealIntactPhotoDataUrl, capturedAt,
      )
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'unloading',
        ...driverPosition(position),
        seal_number_at_destination: e.sealNumberAtDestination,
        gate_photo_artifact_id: sealIntactPhotoId,
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      })
      break
    }
    case 'confirmation': {
      const e = evidence as ConfirmationEvidence
      // Count is optional evidence, not a completion gate — only POD photo + signature
      // required. The signature is already an artifact id: the receiver's own browser
      // rendered the attestation and the server stored it, so there's nothing to upload.
      if (e.podPhotoDataUrl === null || !e.podSignatureArtifactId) {
        throw new Error('Confirmation evidence incomplete — POD photo and receiver confirmation are required.')
      }
      const podPhotoId = await artifactIdFor(
        tripId, 'photo', e.podPhotoArtifactId, e.podPhotoDataUrl, capturedAt,
      )
      const podSignatureId = e.podSignatureArtifactId
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'confirmation',
        ...driverPosition(position),
        pod_photo_artifact_id: podPhotoId,
        pod_signature_artifact_id: podSignatureId,
        // `?? null`: a stale offline entry may have this key missing, not null.
        driver_visual_count: e.driverVisualCount ?? null,
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      })
      break
    }
    case 'in_transit': {
      // No evidence upload — the attestation itself is the submission.
      updatedTrip = await completePhase(tripId, phaseEventId, {
        phase_type: 'in_transit',
        ...driverPosition(position),
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      })
      break
    }
    case 'trip_creation':
      // No request variant server-side; reaching here means a routing bug upstream.
      throw new Error(`submitPhase: "${phaseType}" is never completed by a driver action`)
    default: {
      // Exhaustiveness guard: a new PhaseType fails to compile here.
      const unreachable: never = phaseType
      throw new Error(`submitPhase: unhandled phase type "${String(unreachable)}"`)
    }
  }

  const addressedPhase = updatedTrip.phases.find((p) => p.phase_event_id === phaseEventId) ?? null
  return { ok: true, trip: updatedTrip, phaseStatus: addressedPhase?.status ?? null }
}
