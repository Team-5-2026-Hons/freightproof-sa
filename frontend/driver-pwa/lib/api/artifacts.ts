import { api, ApiError } from './client'
import { actorGeneration, assertActorGeneration } from '@/lib/session/custody-context'
import type { EvidenceRole } from '@shared/lib/types/evidence'

export interface UploadedArtifact {
  id: string
  file_hash: string
}

export type ArtifactType = 'photo' | 'document'

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
  attribution?: ArtifactAttribution
  custodySequence?: number | null
}

export interface ArtifactUpload {
  artifactType: ArtifactType
  dataUrl: string
  capturedAt: string
  capturedLat?: number | null
  capturedLng?: number | null
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

const ARTIFACT_UPLOAD_TIMEOUT_MS = 30_000

export const MAX_ARTIFACT_UPLOAD_BYTES = 10 * 1024 * 1024

function fileExtension(blob: Blob): string {
  return blob.type === 'application/pdf' ? 'pdf' : 'jpg'
}

export async function artifactFormData(upload: ArtifactUpload): Promise<FormData> {
  const generation = actorGeneration()
  const blob = await dataUrlToBlob(upload.dataUrl)
  assertActorGeneration(generation)

  if (blob.size > MAX_ARTIFACT_UPLOAD_BYTES) {
    throw new ApiError(413, 'Photo is too large to upload. Retake it.')
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
