// Manifest: the Parcel Perfect consignment for a trip, grouped by delivery stop.
// Fetched on demand via GET /trips/{id}/manifest, separate from trip detail. Only
// available once the loading phase starts; the endpoint returns 404 before that.
// Mirrors backend ManifestResponse schema.

import type { PPManifestSnapshot } from './pp-manifest'

export type ParcelId = string & { readonly __brand: 'ParcelId' }

export type ParcelStatus = 'pending' | 'scanned_out' | 'scanned_in' | 'exception'

export interface Parcel {
  id: ParcelId
  consignment_id: string
  barcode: string
  description: string | null
  delivery_stop: string | null
  status: ParcelStatus
  pp_scan_out_at: string | null
  pp_scan_in_at: string | null
  created_at: string
  updated_at: string
}

export interface DeliveryStop {
  delivery_stop: string
  parcel_count: number
  parcels: Parcel[]
}

export interface ConsignmentManifest {
  consignment_id: string
  parcel_perfect_reference: string
  client_organization_id: string
  unit_count_expected: number | null
  total_parcel_count: number
  origin_scan_complete: boolean
  stops: DeliveryStop[]
}

export interface Manifest {
  trip_id: string
  total_parcel_count: number
  origin_scan_complete: boolean
  consignments: ConsignmentManifest[]
  pulled_at: string
  pp_manifest_snapshot: PPManifestSnapshot | null
}

export interface Linehaul {
  trip_id: string
  vehicle_registration: string
  vehicle_type: string
  driver_full_name: string
  consolidated_unit_count: number
  origin_scan_complete: boolean
  pulled_at: string
}
