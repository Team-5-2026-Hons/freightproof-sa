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
  capturedAt: string | null
}

export interface H4Evidence {
  gpsLat: number | null
  gpsLng: number | null
  gatePhotoDataUrl: string | null
  sealVerifiedMatch: boolean | null
  capturedAt: string | null
}

export interface H5Evidence {
  waybillHandedOver: boolean | null
  sealBrokenPhotoDataUrl: string | null
  driverVisualCount: number | null
  podPhotoDataUrl: string | null   // blocked BQ2 — always null in demo
  reconciliationNote: string | null
  capturedAt: string | null
}

export type HandshakeEvidence = H1Evidence | H2Evidence | H3Evidence | H4Evidence | H5Evidence
