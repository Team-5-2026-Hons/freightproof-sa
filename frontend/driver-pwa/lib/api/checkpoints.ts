// frontend/driver-pwa/lib/api/checkpoints.ts
import { api } from './client'
import type { Checkpoint, CheckpointId } from '@shared/lib/types/checkpoint'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { uploadArtifact } from './artifacts'

export interface LogCheckpointBody {
  checkpoint_type: string
  driver_phone_lat?: number
  driver_phone_lng?: number
  horse_gps_lat?: number
  horse_gps_lng?: number
  selfie_artifact_id?: string
  cargo_photo_artifact_id?: string
  note?: string
  is_deviation?: boolean
}

// Raw captured checkpoint evidence (data URLs, not yet-uploaded artifacts) — mirrors
// the shape lib/types/evidence-draft.ts uses for H1-H5. Kept here rather than there
// since checkpoints are a driver-initiated capture independent of the five handshakes.
export interface CheckpointEvidence {
  gpsLat: number
  gpsLng: number
  selfieDataUrl: string
  cargoPhotoDataUrl: string
  note: string
  isDeviation: boolean
  capturedAt: string
}

// Raw endpoint call — only ever invoked from submitCheckpoint's real-backend branch
// below (mirrors how completeH1..H5 in lib/api/trips.ts are only called from inside
// submitHandshake), so it needs no demo gate of its own.
export const logCheckpoint = (tripId: string, body: LogCheckpointBody): Promise<Checkpoint> =>
  api.post<Checkpoint>(`/api/v1/trips/${tripId}/checkpoints`, body)

// Demo mode: IS_DEMO_MODE (NEXT_PUBLIC_DEMO_MODE=true/unset) returns a mock success
// immediately, same short-circuit lib/api/handshakes.ts's submitHandshake uses — without
// it, opening the in-transit hub's Log Checkpoint screen in demo mode (the default) fired
// a real fetch at localhost:8000 that always failed.
// Production: uploads the selfie and cargo photos as artifacts, then calls
// POST /trips/{id}/checkpoints with the resulting artifact IDs. The signature
// (tripId, evidence) stays unchanged so useOfflineQueue's retry path (which calls this
// same function to replay a queued checkpoint) keeps working without modification.
export async function submitCheckpoint(tripId: string, evidence: CheckpointEvidence): Promise<Checkpoint> {
  if (IS_DEMO_MODE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    return {
      id: crypto.randomUUID() as unknown as CheckpointId,
      trip_id: tripId,
      checkpoint_type: 'manual',
      driver_phone_lat: evidence.gpsLat,
      driver_phone_lng: evidence.gpsLng,
      horse_gps_lat: null,
      horse_gps_lng: null,
      selfie_artifact_id: null,
      cargo_photo_artifact_id: null,
      note: evidence.note || null,
      is_deviation: evidence.isDeviation,
      merkle_batch_id: null,
      created_at: new Date().toISOString(),
    }
  }

  const [selfie, cargoPhoto] = await Promise.all([
    uploadArtifact({ tripId, artifactType: 'photo', dataUrl: evidence.selfieDataUrl, capturedAt: evidence.capturedAt }),
    uploadArtifact({ tripId, artifactType: 'photo', dataUrl: evidence.cargoPhotoDataUrl, capturedAt: evidence.capturedAt }),
  ])

  return logCheckpoint(tripId, {
    checkpoint_type: 'manual',
    driver_phone_lat: evidence.gpsLat,
    driver_phone_lng: evidence.gpsLng,
    selfie_artifact_id: selfie.id,
    cargo_photo_artifact_id: cargoPhoto.id,
    note: evidence.note || undefined,
    is_deviation: evidence.isDeviation,
  })
}
