// Vehicle: a horse (truck cab) or trailer, each fitted with a Pulsit GPS device.
// A trip has one horse and one or more trailers.
// Mirrors backend VehicleRead schema in schemas/vehicles.py.

export type VehicleId = string & { readonly __brand: 'VehicleId' }

export type VehicleType = 'horse' | 'trailer'

export interface Vehicle {
  id: VehicleId
  organization_id: string
  registration: string
  vehicle_type: VehicleType
  pulsit_device_id: string
  is_active: boolean
  created_at: string
}
