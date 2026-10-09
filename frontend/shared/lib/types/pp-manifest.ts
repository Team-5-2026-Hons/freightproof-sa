// Parcel Perfect manifest types (FP-281) — mirror backend/app/schemas/pp_manifest.py.
// A "PP manifest" is the client's Parcel Perfect manifest. It is not the trip's cargo
// listing in ./manifest.ts; spec §4 keeps the two names apart.

/** A trip's PP manifest key plus a display label. Null on trips without one. */
export interface PPManifestRef {
  issuer_account: string
  origin_hub: string
  number: number
  /** "CGY Logistics · JNB 69": the client, then the manifest as PP staff say it. */
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
  | 'SCHEDULE_INVALID'

export interface PPManifestWarning {
  code: PPManifestWarningCode
  message: string
  /** True for the five codes that refuse creation (spec §10.1). */
  blocking: boolean
  /** The trip holding the manifest or its waybills. Null when that trip belongs to
   *  another organisation: the conflict still blocks, but its identity is private. */
  trip_id: string | null
  trip_reference: string | null
  /** WAYBILL_CLIENT_MISMATCH and WAYBILL_ON_OTHER_TRIP name their waybills. */
  waybills: string[]
}

export interface PPManifestHub {
  hub_code: string
  /** Null when no precinct of the issuing client, visible to this dispatcher, has this hub code. */
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
  /** The linked organisation's name, else PP's issuer name. */
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

// ── The H0 snapshot ───────────────────────────────────────────────────────────
// The PP manifest as it stood at creation, stored on the trip's trip_creation phase row and
// hashed into the journey lock (spec §7.3, §9). GET /trips/{id}/manifest sends it to the
// dispatcher summarised for display (schemas/pp_manifest.py PPManifestSnapshotRead): the
// lines and totals are built by the same backend helper as the preview's, so the panel and
// the create screen describe a manifest identically. The stored JSON, which also holds
// receiver contact details, never leaves the server.

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
