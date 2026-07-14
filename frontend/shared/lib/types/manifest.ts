// Manifest: the Parcel Perfect consignment for a trip, grouped by delivery stop.
// Fetched on demand via GET /trips/{id}/manifest — separate from trip detail.
// Only available after H2 loading starts; the endpoint returns 404 before that.
// Mirrors backend ManifestResponse schema — see api_contract_dispatcher_driver.md §4.3.

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

// Parcels grouped by delivery stop — the shape the driver sees on the H2 loading screen.
export interface DeliveryStop {
  delivery_stop: string
  parcel_count: number
  parcels: Parcel[]
}

export interface Manifest {
  trip_id: string
  consignment_id: string
  parcel_perfect_reference: string
  total_parcel_count: number
  // True once every parcel has a pp_scan_out_at timestamp from Parcel Perfect.
  origin_scan_complete: boolean
  stops: DeliveryStop[]
  pulled_at: string
}

// Linehaul: the driver-facing document for the same GET /trips/{id}/manifest endpoint —
// the backend returns this shape instead of Manifest when the caller is a driver, never
// including per-parcel data or per-stop breakdown (theft-risk rule: drivers see only a
// consolidated unit count, never contents). Mirrors backend LinehaulResponse.
export interface Linehaul {
  trip_id: string
  vehicle_registration: string
  vehicle_type: string
  driver_full_name: string
  consolidated_unit_count: number
  origin_scan_complete: boolean
  pulled_at: string
}
