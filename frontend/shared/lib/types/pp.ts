// Parcel Perfect dispatcher-facing lookup types — mirrors backend
// backend/app/schemas/pp.py exactly. Used by the trip-creation wizard to
// validate a PP waybill reference before it is added as a consignment.

// Wizard-time validation summary. Never the raw PP payload.
export interface PPWaybillSummary {
  waybill: string
  account_number: string
  customer_name: string
  parcel_count: number
  weight_kg: number | null
  declared_value: number | null
  dest_town: string
  dest_person: string
  manifest_number: number | null
  is_delivered: boolean
  has_delivery_failure: boolean
  // Set (to the owning trip's reference) when this waybill is already linked to
  // another trip. Checked FreightProof-side, not by Parcel Perfect itself.
  already_assigned_to_trip: string | null
}

export interface PPCapabilities {
  manifest_lookup: boolean
}
