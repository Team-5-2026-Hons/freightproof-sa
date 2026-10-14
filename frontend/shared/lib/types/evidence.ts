// EvidenceArtifact: a photo or document captured during a handshake or checkpoint.
// Stored in Supabase Storage; only the SHA-256 hash reaches the blockchain.
// Mirrors backend EvidenceArtifactRead schema in schemas/evidence.py.

export type ArtifactId = string & { readonly __brand: 'ArtifactId' }

export type ArtifactType = 'photo' | 'document'

// What a capture was taken for. Mirrors backend EvidenceRole; each value is the stem of the
// phase column (<role>_artifact_id) that records the submitted copy.
export type EvidenceRole =
  | 'linehaul_photo'
  | 'seal_photo'
  | 'waybill_photo'
  | 'pod_photo'
  | 'pod_signature'

export interface EvidenceArtifact {
  id: ArtifactId
  trip_id: string
  artifact_type: ArtifactType
  s3_key: string
  s3_bucket: string
  file_hash: string
  mime_type: string
  captured_at: string
  captured_by_driver_id: string | null
  captured_by_user_id: string | null
  captured_lat: number | null
  captured_lng: number | null
  created_at: string
  // Null together for captures made without attribution (older apps, checkpoint and exception photos).
  phase_event_id: string | null
  evidence_role: EvidenceRole | null
}

// Dispatcher read shape — metadata plus a short-lived signed Storage URL. Mirrors backend
// EvidenceArtifactWithUrl. `signed_url` is null when Storage declined to sign — still
// render the record with the image unavailable rather than hiding it.
export interface EvidenceArtifactWithUrl extends EvidenceArtifact {
  signed_url: string | null
}
