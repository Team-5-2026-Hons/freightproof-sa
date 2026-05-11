// EvidenceArtifact: a photo or document captured during a handshake or checkpoint.
// Stored in Supabase Storage; only the SHA-256 hash reaches the blockchain.
// Mirrors backend EvidenceArtifactRead schema in schemas/evidence.py.

export type ArtifactId = string & { readonly __brand: 'ArtifactId' }

export type ArtifactType = 'photo' | 'document'

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
}
