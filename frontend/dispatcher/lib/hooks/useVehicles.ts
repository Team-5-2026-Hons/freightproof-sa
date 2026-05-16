'use client'

import { useMemo } from 'react'
import { api } from '@/lib/api/client'
import type { Vehicle } from '@shared/lib/types/vehicle'
import { useAsyncData } from './useAsyncData'

const EMPTY: Vehicle[] = []

export interface UseVehiclesResult {
  horses: Vehicle[]
  trailers: Vehicle[]
  all: Vehicle[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useVehicles(): UseVehiclesResult {
  const { data: vehicles, isLoading, error, refetch } = useAsyncData<Vehicle[]>(
    () => api.get<Vehicle[]>('/api/v1/vehicles'),
    EMPTY,
  )

  return useMemo(
    () => ({
      horses: vehicles.filter((v) => v.vehicle_type === 'horse'),
      trailers: vehicles.filter((v) => v.vehicle_type === 'trailer'),
      all: vehicles,
      isLoading,
      error,
      refetch,
    }),
    [vehicles, isLoading, error, refetch],
  )
}
