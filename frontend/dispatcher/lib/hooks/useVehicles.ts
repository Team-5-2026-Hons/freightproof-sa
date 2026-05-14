'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Vehicle } from '@shared/lib/types/vehicle'

export function useVehicles(): {
  horses: Vehicle[]
  trailers: Vehicle[]
  all: Vehicle[]
  refetch: () => void
} {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  const refetch = useCallback(() => {
    api.get<Vehicle[]>('/api/v1/vehicles')
      .then(setVehicles)
      .catch(console.error)
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return useMemo(
    () => ({
      horses: vehicles.filter((v) => v.vehicle_type === 'horse'),
      trailers: vehicles.filter((v) => v.vehicle_type === 'trailer'),
      all: vehicles,
      refetch,
    }),
    [vehicles, refetch],
  )
}
