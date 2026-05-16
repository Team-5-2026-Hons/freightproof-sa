'use client'

import { api } from '@/lib/api/client'
import type { BlockchainReceipt, VehicleEvent } from '@shared/lib/types/blockchain'
import { useAsyncData } from './useAsyncData'

export type VehicleDetail = {
  id: string
  organization_id: string
  registration: string
  vehicle_type: 'horse' | 'trailer'
  pulsit_device_id: string
  make: string | null
  model: string | null
  year: number | null
  vin_number: string | null
  licence_disc_expiry: string | null
  gross_vehicle_mass_kg: number | null
  is_active: boolean
  created_at: string
  events: VehicleEvent[]
  receipts: BlockchainReceipt[]
  trip_ids: string[]
}

export function useVehicleDetail(vehicleId: string | null) {
  return useAsyncData<VehicleDetail | null>(
    async () => {
      if (!vehicleId) return null
      return api.get<VehicleDetail>(`/api/v1/vehicles/${vehicleId}`)
    },
    null,
  )
}
