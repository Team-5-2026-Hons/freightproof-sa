// Seal: a bolt seal applied to a trailer at H3 (origin gate-out) and verified at H4
// (destination gate-in). Not a separate backend entity — derived from HandshakeEvent
// fields (seal_number, seal_photo_artifact_id) for display purposes.

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
