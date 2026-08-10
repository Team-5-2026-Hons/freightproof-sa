// Vehicle: a horse (truck cab) or trailer, each fitted with a Pulsit GPS device.
// A trip has one horse and one or more trailers.
// Mirrors backend VehicleRead schema in schemas/vehicles.py.

import type { VehicleEvent, BlockchainReceipt } from './blockchain'

export type VehicleId = string & { readonly __brand: 'VehicleId' }

export type VehicleType = 'horse' | 'trailer'

export interface Vehicle {
  id: VehicleId
  organization_id: string
  registration: string
  vehicle_type: VehicleType
  pulsit_device_id: string
  is_active: boolean
  make: string | null
  model: string | null
  year: number | null
  vin_number: string | null
  licence_disc_expiry: string | null
  gross_vehicle_mass_kg: number | null
  length_m: number | null
  created_at: string
}

// Extended vehicle shape returned by GET /api/v1/vehicles/:id — includes event/receipt history.
export interface VehicleDetail extends Vehicle {
  events: VehicleEvent[]
  receipts: BlockchainReceipt[]
  trip_ids: string[]
}
