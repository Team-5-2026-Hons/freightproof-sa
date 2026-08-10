'use client'

import { api } from '@/lib/api/client'
import type { Driver } from '@shared/lib/types/driver'
import { useAsyncData } from './useAsyncData'

const EMPTY: Driver[] = []

export interface UseDriversResult {
  drivers: Driver[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useDrivers(): UseDriversResult {
  const { data, isLoading, error, refetch } = useAsyncData<Driver[]>(
    () => api.get<Driver[]>('/api/v1/drivers'),
    EMPTY,
  )
  return { drivers: data, isLoading, error, refetch }
}
