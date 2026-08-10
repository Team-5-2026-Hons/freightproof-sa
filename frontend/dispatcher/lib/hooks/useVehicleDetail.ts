'use client'

import { api } from '@/lib/api/client'
import type { VehicleDetail } from '@shared/lib/types/vehicle'
import { useAsyncData } from './useAsyncData'

export type { VehicleDetail }

export function useVehicleDetail(vehicleId: string | null) {
  return useAsyncData<VehicleDetail | null>(
    async () => {
      if (!vehicleId) return null
      return api.get<VehicleDetail>(`/api/v1/vehicles/${vehicleId}`)
    },
    null,
  )
}
