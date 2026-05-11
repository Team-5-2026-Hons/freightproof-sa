// Checkpoint: a periodic in-transit evidence capture (selfie + cargo photo + GPS).
// Batched into a Merkle tree and anchored to Hedera HCS.
// Mirrors backend CheckpointRead schema in schemas/transit.py.

export type CheckpointId = string & { readonly __brand: 'CheckpointId' }

export interface Checkpoint {
  id: CheckpointId
  trip_id: string
  checkpoint_type: string
  driver_phone_lat: number | null
  driver_phone_lng: number | null
  horse_gps_lat: number | null
  horse_gps_lng: number | null
  selfie_artifact_id: string | null
  cargo_photo_artifact_id: string | null
  note: string | null
  is_deviation: boolean
  merkle_batch_id: string | null
  created_at: string
}
