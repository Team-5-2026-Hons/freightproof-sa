// Seal: a bolt seal applied at departure and verified at unloading. Not a separate
// backend entity — derived from phase fields (seal_number, seal_photo_artifact_id).

export interface Seal {
  seal_number: string
  photo_artifact_id: string | null
}

export interface SealVerification {
  expected: Seal
  actual: Seal
  matched: boolean
  verified_at: string
}
