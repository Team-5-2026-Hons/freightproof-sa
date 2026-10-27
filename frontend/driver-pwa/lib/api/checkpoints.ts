import { api } from './client'
import type { Checkpoint, CheckpointId } from '@shared/lib/types/checkpoint'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { uploadArtifact } from './artifacts'
import { actorGeneration, assertActorGeneration } from '@/lib/session/custody-context'

export interface LogCheckpointBody {
  checkpoint_type: string
  driver_phone_lat?: number
  driver_phone_lng?: number
  driver_captured_at?: string
  driver_accuracy_metres?: number
  client_report_id?: string
  phase_event_id?: string
  horse_gps_lat?: number
  horse_gps_lng?: number
  selfie_artifact_id?: string
  cargo_photo_artifact_id?: string
  note?: string
  is_deviation?: boolean
  custody_sequence?: number
}

export interface CheckpointEvidence {
  gpsLat: number | null
  gpsLng: number | null
  selfieDataUrl?: string | null
  cargoPhotoDataUrl: string
  note: string
  isDeviation: boolean
  capturedAt: string
  clientReportId?: string
  accuracyM?: number | null
  phaseEventId?: string
  custodySequence?: number | null
}

export interface CheckpointArtifactIds {
  cargoPhotoId: string
  selfieId: string | null
}

export function checkpointRequestBody(evidence: CheckpointEvidence, ids: CheckpointArtifactIds): LogCheckpointBody {
  return {
    checkpoint_type: 'manual',
    ...(evidence.gpsLat !== null && evidence.gpsLng !== null
      ? { driver_phone_lat: evidence.gpsLat, driver_phone_lng: evidence.gpsLng }
      : {}),
    driver_captured_at: evidence.capturedAt,
    ...(typeof evidence.accuracyM === 'number' ? { driver_accuracy_metres: evidence.accuracyM } : {}),
    ...(evidence.clientReportId ? { client_report_id: evidence.clientReportId } : {}),
    ...(evidence.phaseEventId ? { phase_event_id: evidence.phaseEventId } : {}),
    ...(ids.selfieId !== null ? { selfie_artifact_id: ids.selfieId } : {}),
    cargo_photo_artifact_id: ids.cargoPhotoId,
    note: evidence.note || undefined,
    is_deviation: evidence.isDeviation,
  }
}

export const logCheckpoint = (tripId: string, body: LogCheckpointBody): Promise<Checkpoint> =>
  api.post<Checkpoint>(`/api/v1/trips/${tripId}/checkpoints`, body)

export async function submitCheckpoint(tripId: string, evidence: CheckpointEvidence): Promise<Checkpoint> {
  const generation = actorGeneration()
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

  const selfieDataUrl = evidence.selfieDataUrl ?? null
  const custodySequence = evidence.custodySequence ?? null
  const [cargoPhoto, selfie] = await Promise.all([
    uploadArtifact({ tripId, artifactType: 'photo', dataUrl: evidence.cargoPhotoDataUrl, capturedAt: evidence.capturedAt, custodySequence }),
    selfieDataUrl === null
      ? Promise.resolve(null)
      : uploadArtifact({ tripId, artifactType: 'photo', dataUrl: selfieDataUrl, capturedAt: evidence.capturedAt, custodySequence }),
  ])

  assertActorGeneration(generation)
  return logCheckpoint(tripId, {
    ...checkpointRequestBody(evidence, { cargoPhotoId: cargoPhoto.id, selfieId: selfie?.id ?? null }),
    ...(custodySequence !== null ? { custody_sequence: custodySequence } : {}),
  })
}
