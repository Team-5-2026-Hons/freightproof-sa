// Manifest: the Parcel Perfect consignment record for a trip, used at H2 (loading)
// and H5 (unloading) to verify parcel counts.
// Mirrors backend ConsignmentRead and ParcelRead schemas in schemas/trips.py.
// Served by GET /trips/{id}/manifest as a separate endpoint.

export type ManifestId = string & { readonly __brand: 'ManifestId' }
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

export interface Manifest {
  id: ManifestId
  trip_id: string | null
  parcel_perfect_reference: string
  client_organization_id: string
  origin_precinct_id: string | null
  destination_precinct_id: string | null
  declared_value: number | null
  parcel_count_expected: number | null
  slot_time_origin: string | null
  slot_time_destination: string | null
  parcels: Parcel[]
  created_at: string
  updated_at: string
}
