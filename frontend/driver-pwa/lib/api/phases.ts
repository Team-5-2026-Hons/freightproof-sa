// One endpoint completes every phase: POST /trips/{id}/phases/{phase_event_id}/complete,
// returning the trip's full updated TripDetailResponse rather than just the phase.
import { api, ApiError } from './client'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseStatus, PhaseType, SealCondition } from '@shared/lib/types/phase'
import type {
  ArrivalEvidence, ConfirmationEvidence, DepartureEvidence,
  LoadingEvidence, PhaseEvidence,
} from '@/lib/types/evidence-draft'
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'
import type { ActionLocationAssessment, DriverLocationCapture } from '@shared/lib/types/action-location'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { sealNumberSource, type SealNumberSource } from '@/lib/ocr/sealSource'
import { uploadArtifact, type ArtifactAttribution, type ArtifactType } from './artifacts'
import { isQueueableFailure } from '@/lib/utils/is-queueable-failure'
import { actorGeneration, assertActorGeneration } from '@/lib/session/custody-context'

interface PhaseCompleteRequestBase {
  idempotency_key: string
  driver_captured_at: string
  location_warning_acknowledged_at?: string
  location_warning_reason?: string
  custody_sequence?: number
}

export interface ActivationCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'activation'>
  driver_phone_lat: number
  driver_phone_lng: number
}

export interface LoadingCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'loading'>
  linehaul_photo_artifact_id: string | null
  linehaul_pdf_artifact_id: string | null
}

export interface DepartureCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'departure'>
  waybill_photo_artifact_id: string | null
  seal_number: string
  seal_photo_artifact_id: string
  seal_number_source: SealNumberSource
}

interface LegacyDepartureWaybillPhoto {
  waybillPhotoDataUrl?: string | null
  waybillPhotoArtifactId?: string | null
}

export interface InTransitCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'in_transit'>
}

export interface ArrivalCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'arrival'>
  seal_condition: SealCondition
  seal_number_at_arrival?: string
  seal_number_source?: SealNumberSource
  seal_photo_artifact_id: string
}

export interface UnloadingCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'unloading'>
}

export interface ConfirmationCompleteRequest extends PhaseCompleteRequestBase {
  phase_type: Extract<PhaseType, 'confirmation'>
  pod_photo_artifact_id: string
  pod_signature_artifact_id: string
  driver_visual_count: number | null
}

export type PhaseCompleteRequest =
  | ActivationCompleteRequest
  | LoadingCompleteRequest
  | DepartureCompleteRequest
  | InTransitCompleteRequest
  | ArrivalCompleteRequest
  | UnloadingCompleteRequest
  | ConfirmationCompleteRequest

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

export interface ArtifactIdRequest {
  tripId: string
  artifactType: ArtifactType
  readyId: string | null
  dataUrl: string
  capturedAt: string
  attribution: ArtifactAttribution
}

async function artifactIdFor(request: ArtifactIdRequest, custodySequence: number | null): Promise<string> {
  if (request.readyId !== null) return request.readyId
  try {
    const uploaded = await uploadArtifact({
      tripId: request.tripId,
      artifactType: request.artifactType,
      dataUrl: request.dataUrl,
      capturedAt: request.capturedAt,
      attribution: request.attribution,
      custodySequence,
    })
    return uploaded.id
  } catch (err) {
    if (err instanceof ApiError && err.code === 'EVIDENCE_ALREADY_RECORDED') {
      const artifactId = err.detail?.evidenceId
      if (artifactId) return artifactId
      throw new Error('Artifact receipt missing; phase completion is unconfirmed.', { cause: err })
    }
    throw err
  }
}

/**
 * Where a phase body's artifact ids come from. The live submit uploads through /artifacts;
 * the late-evidence path (lib/offline/late-evidence-sync.ts) uploads through its own
 * retained-for-review route. Injected so both build the identical body from one switch.
 */
export type ArtifactResolver = (request: ArtifactIdRequest) => Promise<string>

async function optionalLinehaulPdfId(resolve: ArtifactResolver, request: ArtifactIdRequest): Promise<string | null> {
  try {
    return await resolve(request)
  } catch (err) {
    if (isQueueableFailure(err)) throw err
    console.warn('Linehaul PDF upload rejected; completing loading without it.', err)
    return null
  }
}

export interface SubmitPhaseResult {
  ok: boolean
  trip: Trip | null
  phaseStatus: PhaseStatus | null
}

export interface PhaseRequestInput {
  tripId: string
  phaseEventId: string
  phaseType: PhaseType
  evidence: PhaseEvidence
  idempotencyKey: string
  position: DriverPosition | null
  driverCapturedAt: string
  acknowledgement: LocationWarningAcknowledgement | null
}

/**
 * The phase-complete body for a captured draft, without sending it. Throws the same local
 * validation errors submitPhase always has. Shared by the live submit and the
 * late-evidence path so a late phase report is exactly the body the live one would have been.
 */
export async function buildPhaseCompleteRequest(
  input: PhaseRequestInput,
  resolve: ArtifactResolver,
): Promise<PhaseCompleteRequest> {
  const { tripId, phaseEventId, phaseType, evidence, idempotencyKey, position, driverCapturedAt, acknowledgement } = input
  const capturedAt = evidence.capturedAt ?? new Date().toISOString()
  const acknowledgementFields = locationWarningAcknowledgement(acknowledgement)
  switch (phaseType) {
    case 'activation': {
      if (position === null) {
        throw new Error(
          'Could not get your location. Move to open sky, check that Location is enabled for this app, and swipe again.',
        )
      }
      return {
        phase_type: 'activation',
        driver_phone_lat: position.lat,
        driver_phone_lng: position.lng,
        ...(position.accuracyM === null ? {} : { driver_accuracy_metres: position.accuracyM }),
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      }
    }
    case 'loading': {
      const e = evidence as LoadingEvidence
      const linehaulPhotoId = e.linehaulPhotoDataUrl !== null
        ? await resolve({
            tripId, artifactType: 'photo', readyId: e.linehaulPhotoArtifactId,
            dataUrl: e.linehaulPhotoDataUrl, capturedAt,
            attribution: { phaseEventId, role: 'linehaul_photo' },
          })
        : null
      const linehaulPdfDataUrl = e.linehaulPdfDataUrl ?? null
      const linehaulPdfId = linehaulPdfDataUrl !== null
        ? await optionalLinehaulPdfId(resolve, {
            tripId, artifactType: 'document', readyId: e.linehaulPdfArtifactId ?? null,
            dataUrl: linehaulPdfDataUrl, capturedAt,
            attribution: { phaseEventId, role: 'linehaul_pdf' },
          })
        : e.linehaulPdfArtifactId ?? null
      return {
        phase_type: 'loading',
        ...driverPosition(position),
        linehaul_photo_artifact_id: linehaulPhotoId,
        linehaul_pdf_artifact_id: linehaulPdfId,
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      }
    }
    case 'departure': {
      const e = evidence as DepartureEvidence
      if (e.sealPhotoDataUrl === null || e.sealNumber === null) {
        throw new Error('Departure evidence incomplete: seal photo and seal number are required.')
      }
      const legacy = evidence as LegacyDepartureWaybillPhoto
      const legacyWaybillDataUrl = legacy.waybillPhotoDataUrl ?? null
      const [waybillPhotoId, sealPhotoId] = await Promise.all([
        legacyWaybillDataUrl !== null
          ? resolve({
              tripId, artifactType: 'photo', readyId: legacy.waybillPhotoArtifactId ?? null,
              dataUrl: legacyWaybillDataUrl, capturedAt,
              attribution: { phaseEventId, role: 'waybill_photo' },
            })
          : Promise.resolve(null),
        resolve({
          tripId, artifactType: 'photo', readyId: e.sealPhotoArtifactId,
          dataUrl: e.sealPhotoDataUrl, capturedAt,
          attribution: { phaseEventId, role: 'seal_photo' },
        }),
      ])
      return {
        phase_type: 'departure',
        ...driverPosition(position),
        waybill_photo_artifact_id: waybillPhotoId,
        seal_number: e.sealNumber,
        seal_photo_artifact_id: sealPhotoId,
        seal_number_source: sealNumberSource(e.sealNumberOcr ?? null, e.sealNumber),
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      }
    }
    case 'arrival': {
      const e = evidence as ArrivalEvidence
      if (e.sealCondition === null || !e.sealPhotoDataUrl) {
        throw new Error('Arrival evidence incomplete: seal condition and seal photo are required.')
      }
      if (e.sealCondition !== 'missing' && e.sealNumberAtArrival === null) {
        throw new Error('Arrival evidence incomplete: seal number is required unless the seal is missing.')
      }
      const sealPhotoId = await resolve({
        tripId, artifactType: 'photo', readyId: e.sealPhotoArtifactId,
        dataUrl: e.sealPhotoDataUrl, capturedAt,
        attribution: { phaseEventId, role: 'seal_photo' },
      })
      return {
        phase_type: 'arrival',
        ...driverPosition(position),
        seal_condition: e.sealCondition,
        ...(e.sealCondition === 'missing' ? {} : {
          seal_number_at_arrival: e.sealNumberAtArrival ?? undefined,
          seal_number_source: sealNumberSource(e.sealNumberAtArrivalOcr ?? null, e.sealNumberAtArrival ?? ''),
        }),
        seal_photo_artifact_id: sealPhotoId,
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      }
    }
    case 'unloading': {
      return {
        phase_type: 'unloading',
        ...driverPosition(position),
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      }
    }
    case 'confirmation': {
      const e = evidence as ConfirmationEvidence
      if (e.podPhotoDataUrl === null || !e.podSignatureArtifactId) {
        throw new Error('Confirmation evidence incomplete: POD photo and receiver confirmation are required.')
      }
      const podPhotoId = await resolve({
        tripId, artifactType: 'photo', readyId: e.podPhotoArtifactId,
        dataUrl: e.podPhotoDataUrl, capturedAt,
        attribution: { phaseEventId, role: 'pod_photo' },
      })
      const podSignatureId = e.podSignatureArtifactId
      return {
        phase_type: 'confirmation',
        ...driverPosition(position),
        pod_photo_artifact_id: podPhotoId,
        pod_signature_artifact_id: podSignatureId,
        driver_visual_count: e.driverVisualCount ?? null,
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      }
    }
    case 'in_transit': {
      return {
        phase_type: 'in_transit',
        ...driverPosition(position),
        idempotency_key: idempotencyKey,
        driver_captured_at: driverCapturedAt,
        ...acknowledgementFields,
      }
    }
    case 'trip_creation':
      throw new Error(`submitPhase: "${phaseType}" is never completed by a driver action`)
    default: {
      const unreachable: never = phaseType
      throw new Error(`submitPhase: unhandled phase type "${String(unreachable)}"`)
    }
  }
}

export async function submitPhase(
  tripId: string,
  phaseEventId: string,
  phaseType: PhaseType,
  evidence: PhaseEvidence,
  idempotencyKey: string,
  position: DriverPosition | null,
  driverCapturedAt: string,
  acknowledgement: LocationWarningAcknowledgement | null = null,
  custodySequence: number | null = null,
): Promise<SubmitPhaseResult> {
  const generation = actorGeneration()
  if (IS_DEMO_MODE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    return { ok: true, trip: null, phaseStatus: 'completed' }
  }
  const request = await buildPhaseCompleteRequest(
    { tripId, phaseEventId, phaseType, evidence, idempotencyKey, position, driverCapturedAt, acknowledgement },
    (artifact) => {
      assertActorGeneration(generation)
      return artifactIdFor(artifact, custodySequence)
    },
  )
  assertActorGeneration(generation)
  const updatedTrip = await completePhase(tripId, phaseEventId, {
    ...request,
    ...(custodySequence !== null ? { custody_sequence: custodySequence } : {}),
  })

  const addressedPhase = updatedTrip.phases.find((p) => p.phase_event_id === phaseEventId) ?? null
  return { ok: true, trip: updatedTrip, phaseStatus: addressedPhase?.status ?? null }
}
