'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import type { Vehicle } from '@shared/lib/types/vehicle'

export function useVehicles(): { horses: Vehicle[]; trailers: Vehicle[]; all: Vehicle[] } {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  useEffect(() => {
    api.get<Vehicle[]>('/api/v1/vehicles')
      .then(setVehicles)
      .catch(console.error)
  }, [])

  return useMemo(() => ({
    horses: vehicles.filter(v => v.vehicle_type === 'horse'),
    trailers: vehicles.filter(v => v.vehicle_type === 'trailer'),
    all: vehicles,
  }), [vehicles])
}
