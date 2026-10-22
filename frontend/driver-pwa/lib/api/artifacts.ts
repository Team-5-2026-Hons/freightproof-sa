import { api, ApiError } from './client'
import { actorGeneration, assertActorGeneration } from '@/lib/session/custody-context'
import type { EvidenceRole } from '@shared/lib/types/evidence'

export interface UploadedArtifact {
  id: string
  file_hash: string
}

// Named and exported so callers that upload early (lib/hooks/useArtifactUpload.ts) can
// type their own arguments against the same union.
export type ArtifactType = 'photo' | 'document'

// Which phase and slot a capture is for. One object, not two optional fields, so a caller
// cannot send half a pair: the backend 422s a lone phase_event_id or evidence_role.
export interface ArtifactAttribution {
  phaseEventId: string
  role: EvidenceRole
}

interface UploadArtifactParams {
  tripId: string
  artifactType: ArtifactType
  dataUrl: string
  capturedAt: string
  capturedLat?: number | null
  capturedLng?: number | null
  // Omitted by callers that have no phase slot (checkpoint and exception photos) and by
  // older app builds; the backend stores those unattributed, exactly as before.
  attribution?: ArtifactAttribution
  // The custody period the photo was CAPTURED in (never the period at upload time).
  // Omitted when unknown — the server accepts that only before any substitution.
  custodySequence?: number | null
}

// The fields every driver upload route shares: the ordinary /artifacts route and the two
// other routes (handover check, late evidence) take "existing artifact multipart fields"
// plus their own extras, so all three build from this one shape.
export interface ArtifactUpload {
  artifactType: ArtifactType
  dataUrl: string
  capturedAt: string
  capturedLat?: number | null
  capturedLng?: number | null
}

// Captured photos live in evidence drafts as base64 data URLs (see lib/types/evidence-draft.ts);
// the backend wants a real file upload, so this converts the data URL to a Blob first.
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

// Multipart photo uploads over a driver's mobile/cellular connection can genuinely take
// longer than the default 12s request ceiling — this must be generous enough that a
// slow-but-succeeding upload doesn't get aborted client-side while the backend is still
// receiving it (which previously misreported "stored on this device" for evidence that
// actually made it to the server).
const ARTIFACT_UPLOAD_TIMEOUT_MS = 30_000

// Client-side mirror of the backend's artifact size cap. The backend is the source of
// truth — backend/app/orchestration/evidence/artifacts.py (MAX_FILE_SIZE_BYTES); keep the
// two in sync if that limit ever changes. Checked BEFORE any network call so an
// oversized photo fails in milliseconds instead of burning a full 30s mobile-data
// upload into a guaranteed rejection.
export const MAX_ARTIFACT_UPLOAD_BYTES = 10 * 1024 * 1024

// The backend decides the type from the bytes (mime_allowlist.py); the name only has to
// stop a stored PDF from carrying a .jpg extension into Storage and downloads.
function fileExtension(blob: Blob): string {
  return blob.type === 'application/pdf' ? 'pdf' : 'jpg'
}

// Converts the capture and enforces the size cap before any network call, then returns the
// shared multipart fields. Callers append their route-specific extras.
export async function artifactFormData(upload: ArtifactUpload): Promise<FormData> {
  const generation = actorGeneration()
  const blob = await dataUrlToBlob(upload.dataUrl)
  assertActorGeneration(generation)

  // Synthetic 413 (never emitted by the fetch wrapper itself) keeps this failure
  // TERMINAL: offline-queue classification (isQueueableFailure) only retries status 0
  // and >=500, and an oversized photo can never shrink on retry — the driver has to
  // retake it, so queueing would be dishonest.
  if (blob.size > MAX_ARTIFACT_UPLOAD_BYTES) {
    throw new ApiError(413, 'Photo is too large to upload — retake it.')
  }

  const form = new FormData()
  form.append('artifact_type', upload.artifactType)
  form.append('captured_at', upload.capturedAt)
  if (upload.capturedLat != null) form.append('captured_lat', String(upload.capturedLat))
  if (upload.capturedLng != null) form.append('captured_lng', String(upload.capturedLng))
  form.append('file', blob, `${upload.artifactType}.${fileExtension(blob)}`)
  return form
}

export async function uploadArtifact(params: UploadArtifactParams): Promise<UploadedArtifact> {
  const generation = actorGeneration()
  const form = await artifactFormData(params)
  assertActorGeneration(generation)
  form.append('trip_id', params.tripId)
  if (params.attribution !== undefined) {
    form.append('phase_event_id', params.attribution.phaseEventId)
    form.append('evidence_role', params.attribution.role)
  }
  if (params.custodySequence != null) form.append('custody_sequence', String(params.custodySequence))

  return api.postForm<UploadedArtifact>('/api/v1/artifacts', form, { timeoutMs: ARTIFACT_UPLOAD_TIMEOUT_MS })
}

export { ARTIFACT_UPLOAD_TIMEOUT_MS }
