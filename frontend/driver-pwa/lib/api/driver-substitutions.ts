// Driver-side reads for driver substitution (docs/contracts/driver-substitution-v1.md,
// "Driver endpoints"). Every shape is the shared contract type — this file adds no DTO of its
// own, so the live OpenAPI comparison has exactly one schema to check against.
//
// Kept apart from lib/api/trips.ts on purpose: a pending substitution is NOT the driver's
// current trip. GET /trips/me/active stays the current-assignment read; these are a second,
// independent resource the incoming driver needs even when they have no trip at all.

import { api, ApiError } from './client'
import { actorGeneration, assertActorGeneration } from '@/lib/session/custody-context'
import { ARTIFACT_UPLOAD_TIMEOUT_MS, artifactFormData, type ArtifactUpload } from './artifacts'
import type { EvidenceArtifact } from '@shared/lib/types/evidence'
import type {
  ConfirmSubstitutionRequest,
  ConfirmSubstitutionObservationRequest,
  DriverParticipationHistoryRead,
  DriverSubstitutionContextRead,
  LateEvidenceRead,
  LateEvidenceRequest,
  SubstitutionErrorCode,
  SubstitutionNoticeRead,
  SubstitutionRequestRead,
  SubstitutionRole,
} from '@shared/lib/types/driver-substitution'

const TRIPS_ME = '/api/v1/trips/me'

export const fetchDriverSubstitutions = (): Promise<SubstitutionRequestRead[]> =>
  api.get<SubstitutionRequestRead[]>(`${TRIPS_ME}/driver-substitutions`)

export const fetchDriverSubstitutionContext = (
  tripId: string,
  requestId: string,
): Promise<DriverSubstitutionContextRead> =>
  api.get<DriverSubstitutionContextRead>(`${TRIPS_ME}/${tripId}/driver-substitutions/${requestId}`)

export const fetchSubstitutionNotices = (unreadOnly = true): Promise<SubstitutionNoticeRead[]> =>
  api.get<SubstitutionNoticeRead[]>(`${TRIPS_ME}/substitution-notices?unread_only=${unreadOnly}`)

export const markSubstitutionNoticeRead = (noticeId: string): Promise<SubstitutionNoticeRead> =>
  api.post<SubstitutionNoticeRead>(`${TRIPS_ME}/substitution-notices/${noticeId}/read`)

export const fetchDriverParticipation = (tripId: string): Promise<DriverParticipationHistoryRead> =>
  api.get<DriverParticipationHistoryRead>(`${TRIPS_ME}/${tripId}/participation`)

/**
 * A photo for this driver's handover check, through the request's dedicated route. A pending
 * INCOMING driver is not yet on the trip, so the ordinary /artifacts route (which checks
 * trip ownership) is never assumed to accept it. `role` is only the claimed purpose; the
 * server validates it against the signed-in account. `clientRequestId` is per photo and
 * stable across retries, so a lost response never stores the photo twice.
 */
export async function uploadSubstitutionArtifact(
  tripId: string,
  requestId: string,
  role: SubstitutionRole,
  upload: ArtifactUpload & { clientRequestId: string },
): Promise<EvidenceArtifact> {
  const generation = actorGeneration()
  const form = await artifactFormData(upload)
  assertActorGeneration(generation)
  form.append('client_request_id', upload.clientRequestId)
  form.append('role', role)
  return api.postForm<EvidenceArtifact>(
    `${TRIPS_ME}/${tripId}/driver-substitutions/${requestId}/artifacts`,
    form,
    { timeoutMs: ARTIFACT_UPLOAD_TIMEOUT_MS },
  )
}

/**
 * Submit this driver's confirmation. 200 whether the transfer completed or the capture was
 * saved but is still waiting (missing_confirmations / completion_blocked_by say which) —
 * a pending answer is a SAVED capture, never a failure to retry.
 */
export const confirmDriverSubstitution = (
  tripId: string,
  requestId: string,
  body: ConfirmSubstitutionRequest | ConfirmSubstitutionObservationRequest,
): Promise<SubstitutionRequestRead> =>
  api.post<SubstitutionRequestRead>(`${TRIPS_ME}/${tripId}/driver-substitutions/${requestId}/confirmations`, body)

/** A photo for a late-evidence report, tagged with the custody period it was captured in. */
export async function uploadLateEvidenceArtifact(
  tripId: string,
  custodySequence: number,
  upload: ArtifactUpload & { clientRequestId: string },
): Promise<EvidenceArtifact> {
  const generation = actorGeneration()
  const form = await artifactFormData(upload)
  assertActorGeneration(generation)
  form.append('client_request_id', upload.clientRequestId)
  form.append('custody_sequence', String(custodySequence))
  return api.postForm<EvidenceArtifact>(`${TRIPS_ME}/${tripId}/late-evidence/artifacts`, form, {
    timeoutMs: ARTIFACT_UPLOAD_TIMEOUT_MS,
  })
}

/** 201 receipt; an exact replay returns the same receipt. Acknowledgement is dispatcher review. */
export const submitLateEvidence = (tripId: string, body: LateEvidenceRequest): Promise<LateEvidenceRead> =>
  api.post<LateEvidenceRead>(`${TRIPS_ME}/${tripId}/late-evidence`, body)

export function hasErrorCode(err: unknown, code: SubstitutionErrorCode): err is ApiError {
  return err instanceof ApiError && err.code === code
}

export const isTripHandedOver = (err: unknown): err is ApiError => hasErrorCode(err, 'TRIP_HANDED_OVER')
