// Parcel Perfect manifest types (FP-281) — mirror backend/app/schemas/pp_manifest.py.
// A "PP manifest" is the client's Parcel Perfect manifest. It is not the trip's cargo
// listing in ./manifest.ts; spec §4 keeps the two names apart.

/** A trip's PP manifest key plus a display label. Null on trips without one. */
export interface PPManifestRef {
  issuer_account: string
  origin_hub: string
  number: number
  display: string
}

export type PPManifestWarningCode =
  | 'MANIFEST_ALREADY_ON_TRIP'
  | 'CLIENT_NOT_LINKED'
  | 'WAYBILL_CLIENT_MISMATCH'
  | 'WAYBILL_ON_OTHER_TRIP'
  | 'NO_WAYBILLS'
  | 'ORIGIN_HUB_UNLINKED'
  | 'DESTINATION_HUB_UNLINKED'
  | 'NO_PLANNED_TIMES'
  | 'MANIFEST_NOT_CLOSED'

/** Codes on create's 409/422 bodies that are not preview warnings. */
export type PPManifestErrorCode =
  | 'MANIFEST_CHANGED'
  | 'PRECINCT_REQUIRED'
  | 'PRECINCT_NOT_AVAILABLE'
  | 'SAME_PRECINCT'
  | 'NO_PLANNED_DEPARTURE'
  | 'NO_PLANNED_ARRIVAL'
  | 'SCHEDULE_INVALID'

export interface PPManifestWarning {
  code: PPManifestWarningCode
  message: string
  blocking: boolean
  trip_id: string | null
  trip_reference: string | null
  waybills: string[]
}

export interface PPManifestHub {
  hub_code: string
  precinct_id: string | null
  precinct_name: string | null
}

export interface PPManifestNote {
  noted_at: string
  operator: string
  text: string
}

export interface PPManifestWaybillLine {
  waybill: string
  destination_town: string
  parcel_count: number
  weight_kg: number | null
}

export interface PPManifestTotals {
  waybills: number
  parcels: number
  weight_kg: number
}

/** GET /api/v1/trips/pp-manifest-preview. Read-only. snapshot_sha256 goes back with the
 *  create request, so what the dispatcher reviewed is what gets locked (spec §10.2). */
export interface PPManifestPreview {
  pp_manifest: PPManifestRef
  snapshot_sha256: string
  client_organization_id: string | null
  client_name: string
  origin: PPManifestHub
  destination: PPManifestHub
  planned_departure_at: string | null
  expected_arrival_at: string | null
  is_closed: boolean
  client_reference: string | null
  notes: PPManifestNote[]
  totals: PPManifestTotals
  waybills: PPManifestWaybillLine[]
  warnings: PPManifestWarning[]
  can_create: boolean
}

/** POST /api/v1/trips/from-pp-manifest. Cargo is never sent: the server pulls it.
 *  A null time means "use the manifest's". Times must carry a zone. A precinct is read
 *  only for a hub the manifest could not link. */
export interface TripFromPPManifestPayload {
  manifest_number: number
  expected_snapshot_sha256: string
  driver_id: string
  horse_id: string
  trailer_ids: string[]
  planned_departure_at: string | null
  planned_arrival_at: string | null
  origin_precinct_id: string | null
  destination_precinct_id: string | null
}

export interface PPManifestSnapshot {
  manifest_number: number
  issuer_account: string
  issuer_name: string
  origin_hub: string
  destination_hub: string
  client_reference: string | null
  waybills: PPManifestWaybillLine[]
  totals: PPManifestTotals
}
