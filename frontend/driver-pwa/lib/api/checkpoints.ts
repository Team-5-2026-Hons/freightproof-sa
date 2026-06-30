// frontend/driver-pwa/lib/api/checkpoints.ts
import { api } from './client'
import type { Checkpoint } from '@shared/lib/types/checkpoint'

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

// No in-transit checkpoint UI exists yet (out of scope for this pass — flagged, not built);
// this module exists so the in-transit hub can wire it in without touching lib/api/ again.
export const logCheckpoint = (tripId: string, body: LogCheckpointBody): Promise<Checkpoint> =>
  api.post<Checkpoint>(`/api/v1/trips/${tripId}/checkpoints`, body)
