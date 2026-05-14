'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Driver } from '@shared/lib/types/driver'

export function useDrivers(): { drivers: Driver[]; refetch: () => void } {
  const [drivers, setDrivers] = useState<Driver[]>([])

  const refetch = useCallback(() => {
    api.get<Driver[]>('/api/v1/drivers')
      .then(setDrivers)
      .catch(console.error)
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { drivers, refetch }
}
