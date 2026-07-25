// frontend/driver-pwa/lib/api/artifacts.ts
import { api, ApiError } from './client'

export interface UploadedArtifact {
  id: string
  file_hash: string
}

interface UploadArtifactParams {
  tripId: string
  artifactType: 'photo' | 'document'
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
// truth — backend/app/orchestration/artifact_service.py (MAX_FILE_SIZE_BYTES); keep the
// two in sync if that limit ever changes. Checked BEFORE any network call so an
// oversized photo fails in milliseconds instead of burning a full 30s mobile-data
// upload into a guaranteed rejection.
export const MAX_ARTIFACT_UPLOAD_BYTES = 10 * 1024 * 1024

export async function uploadArtifact(params: UploadArtifactParams): Promise<UploadedArtifact> {
  const blob = await dataUrlToBlob(params.dataUrl)

  // Synthetic 413 (never emitted by the fetch wrapper itself) keeps this failure
  // TERMINAL: offline-queue classification (isQueueableFailure) only retries status 0
  // and >=500, and an oversized photo can never shrink on retry — the driver has to
  // retake it, so queueing would be dishonest.
  if (blob.size > MAX_ARTIFACT_UPLOAD_BYTES) {
    throw new ApiError(413, 'Photo is too large to upload — retake it.')
  }

  const form = new FormData()
  form.append('trip_id', params.tripId)
  form.append('artifact_type', params.artifactType)
  form.append('captured_at', params.capturedAt)
  if (params.capturedLat != null) form.append('captured_lat', String(params.capturedLat))
  if (params.capturedLng != null) form.append('captured_lng', String(params.capturedLng))
  form.append('file', blob, `${params.artifactType}.jpg`)

  return api.postForm<UploadedArtifact>('/api/v1/artifacts', form, { timeoutMs: ARTIFACT_UPLOAD_TIMEOUT_MS })
}
