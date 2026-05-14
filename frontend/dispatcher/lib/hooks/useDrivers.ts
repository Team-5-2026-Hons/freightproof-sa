'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Driver } from '@shared/lib/types/driver'

export function useDrivers(): Driver[] {
  const [drivers, setDrivers] = useState<Driver[]>([])

  useEffect(() => {
    api.get<Driver[]>('/api/v1/drivers')
      .then(setDrivers)
      .catch(console.error)
  }, [])

  return drivers
}
