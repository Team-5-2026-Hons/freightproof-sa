// frontend/driver-pwa/lib/api/artifacts.ts
import { api } from './client'

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

export async function uploadArtifact(params: UploadArtifactParams): Promise<UploadedArtifact> {
  const blob = await dataUrlToBlob(params.dataUrl)

  const form = new FormData()
  form.append('trip_id', params.tripId)
  form.append('artifact_type', params.artifactType)
  form.append('captured_at', params.capturedAt)
  if (params.capturedLat != null) form.append('captured_lat', String(params.capturedLat))
  if (params.capturedLng != null) form.append('captured_lng', String(params.capturedLng))
  form.append('file', blob, `${params.artifactType}.jpg`)

  return api.postForm<UploadedArtifact>('/api/v1/artifacts', form)
}
