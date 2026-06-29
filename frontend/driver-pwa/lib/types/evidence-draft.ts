// frontend/driver-pwa/lib/types/evidence-draft.ts

export interface H1Evidence {
  gpsLat: number | null
  gpsLng: number | null
  gatePhotoDataUrl: string | null
  // Populated via Google Geocoding API reverse-lookup of gpsLat/gpsLng — display-only, not sent to a backend yet.
  gateAddress: string | null
  capturedAt: string | null
}

export interface H2Evidence {
  gpsLat: number | null
  gpsLng: number | null
  ppManifestParcelCount: number | null
  driverVisualCount: number | null
  waybillPhotoDataUrl: string | null
  sealNumber: string | null
  sealPhotoDataUrl: string | null
  capturedAt: string | null
}

export interface H3Evidence {
  gpsLat: number | null
  gpsLng: number | null
  gatePhotoDataUrl: string | null
  sealNumberConfirmed: string | null
  // Deviation from original plan spec (authorized fix, post Task-9 review): mirrors H4Evidence's
  // sealVerifiedMatch so H3's "confirm seal" step performs a real comparison against H2's seal, not just free text.
  sealVerifiedMatch: boolean | null
  capturedAt: string | null
}

export interface H4Evidence {
  gpsLat: number | null
  gpsLng: number | null
  gatePhotoDataUrl: string | null
  // The driver's typed seal entry at destination — backend needs the actual value
  // (H4CompleteRequest.seal_number_at_destination), not just whether it matched H2's seal.
  sealNumberAtDestination: string | null
  sealVerifiedMatch: boolean | null
  capturedAt: string | null
}

export interface H5Evidence {
  waybillHandedOver: boolean | null
  sealBrokenPhotoDataUrl: string | null
  driverVisualCount: number | null
  // BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
  // signature — both required, not either/or.
  podPhotoDataUrl: string | null
  podSignatureDataUrl: string | null
  reconciliationNote: string | null
  capturedAt: string | null
}

export type HandshakeEvidence = H1Evidence | H2Evidence | H3Evidence | H4Evidence | H5Evidence
