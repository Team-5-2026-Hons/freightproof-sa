'use client'

import { api } from '@/lib/api/client'
import type { BlockchainReceipt, DriverEvent } from '@shared/lib/types/blockchain'
import { useAsyncData } from './useAsyncData'

export type DriverDetail = {
  id: string
  organization_id: string
  full_name: string
  id_number: string
  phone_number: string
  license_number: string
  license_expiry: string | null
  idvs_status: 'pending' | 'verified' | 'failed'
  is_active: boolean
  created_at: string
  updated_at: string
  events: DriverEvent[]
  receipts: BlockchainReceipt[]
  trip_ids: string[]
}

export function useDriverDetail(driverId: string | null) {
  return useAsyncData<DriverDetail | null>(
    async () => {
      if (!driverId) return null
      return api.get<DriverDetail>(`/api/v1/drivers/${driverId}`)
    },
    null,
  )
}
