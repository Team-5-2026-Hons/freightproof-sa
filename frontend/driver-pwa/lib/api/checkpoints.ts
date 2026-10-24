import { api } from './client'
import type { Checkpoint, CheckpointId } from '@shared/lib/types/checkpoint'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { uploadArtifact } from './artifacts'
import { actorGeneration, assertActorGeneration } from '@/lib/session/custody-context'

export interface LogCheckpointBody {
  checkpoint_type: string
  driver_phone_lat?: number
  driver_phone_lng?: number
  // The instant this app stamped the submission (CheckpointEvidence.capturedAt,
  // already taken at submit time and already persisted into the offline queue via the
  // queued evidence object — see CheckpointPageClient.tsx). Optional on the wire for the
  // same backend-compatibility reason as phases.ts's driver_captured_at, but this build
  // always sends it.
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
  // The custody period the checkpoint was captured in. Omitted when unknown.
  custody_sequence?: number
}

// Raw captured checkpoint evidence (data URLs, not yet-uploaded artifacts) — mirrors
// the shape lib/types/evidence-draft.ts uses for phase evidence. Kept here rather than
// there since checkpoints are a driver-initiated capture independent of the phases.
export interface CheckpointEvidence {
  // Nullable since the GPS capture step was removed: the app now takes the fix silently
  // as the driver submits, and a failed fix (a tunnel, a denied permission) must never
  // stop a checkpoint's photos from being recorded. The wire fields were already
  // optional (LogCheckpointBody above), so nothing downstream changes.
  gpsLat: number | null
  gpsLng: number | null
  // Optional since the screen no longer takes a selfie (the backend has
  // always accepted a checkpoint without one). Kept on the type, not deleted: a checkpoint
  // queued offline by an older build is stored WITH its selfie and must still replay.
  selfieDataUrl?: string | null
  cargoPhotoDataUrl: string
  note: string
  isDeviation: boolean
  capturedAt: string
  // Generated at the driver action boundary and retained by the offline queue so a
  // retried checkpoint is the same evidence record, not a second checkpoint.
  clientReportId?: string
  accuracyM?: number | null
  phaseEventId?: string
  // Stamped with the rest of the capture (lib/session/custody-context.ts) so a replay
  // after a handover still names the period it was taken in. Absent on older queued entries.
  custodySequence?: number | null
}

export interface CheckpointArtifactIds {
  cargoPhotoId: string
  selfieId: string | null
}

// The wire body for a checkpoint whose photos are uploaded. Shared with the late-evidence
// path (lib/offline/late-evidence-sync.ts), which embeds this same body unchanged — minus
// the custody field, which late evidence carries at its own top level.
export function checkpointRequestBody(evidence: CheckpointEvidence, ids: CheckpointArtifactIds): LogCheckpointBody {
  return {
    checkpoint_type: 'manual',
    // Omitted, not nulled, when there is no fix — same reasoning as phases.ts's
    // driverPosition(): a null must not overwrite a position a previous attempt stored.
    ...(evidence.gpsLat !== null && evidence.gpsLng !== null
      ? { driver_phone_lat: evidence.gpsLat, driver_phone_lng: evidence.gpsLng }
      : {}),
    // Already stamped at submit time onto the evidence object (see
    // CheckpointPageClient.tsx), so replaying this from the offline queue sends the
    // ORIGINAL submit instant, never the flush-time clock.
    driver_captured_at: evidence.capturedAt,
    ...(typeof evidence.accuracyM === 'number' ? { driver_accuracy_metres: evidence.accuracyM } : {}),
    ...(evidence.clientReportId ? { client_report_id: evidence.clientReportId } : {}),
    ...(evidence.phaseEventId ? { phase_event_id: evidence.phaseEventId } : {}),
    // Omitted when there is none: the field is optional on the backend.
    ...(ids.selfieId !== null ? { selfie_artifact_id: ids.selfieId } : {}),
    cargo_photo_artifact_id: ids.cargoPhotoId,
    note: evidence.note || undefined,
    is_deviation: evidence.isDeviation,
  }
}

// Raw endpoint call — only ever invoked from submitCheckpoint's real-backend branch
// below, so it needs no demo gate of its own.
export const logCheckpoint = (tripId: string, body: LogCheckpointBody): Promise<Checkpoint> =>
  api.post<Checkpoint>(`/api/v1/trips/${tripId}/checkpoints`, body)

// Demo mode: IS_DEMO_MODE (NEXT_PUBLIC_DEMO_MODE=true/unset) returns a mock success
// immediately, the same short-circuit the phase submit uses — without
// it, opening the in-transit hub's Log Checkpoint screen in demo mode (the default) fired
// a real fetch at localhost:8000 that always failed.
// Production: uploads the cargo photo (and a legacy selfie, if a queued one carries it)
// as artifacts, then calls
// POST /trips/{id}/checkpoints with the resulting artifact IDs. The signature
// (tripId, evidence) stays unchanged so useOfflineQueue's retry path (which calls this
// same function to replay a queued checkpoint) keeps working without modification.
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
