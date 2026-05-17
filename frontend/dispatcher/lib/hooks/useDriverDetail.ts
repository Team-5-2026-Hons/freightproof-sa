'use client'

import { api } from '@/lib/api/client'
import type { DriverDetail } from '@shared/lib/types/driver'
import { useAsyncData } from './useAsyncData'

export type { DriverDetail }

export function useDriverDetail(driverId: string | null) {
  return useAsyncData<DriverDetail | null>(
    async () => {
      if (!driverId) return null
      return api.get<DriverDetail>(`/api/v1/drivers/${driverId}`)
    },
    null,
  )
}
