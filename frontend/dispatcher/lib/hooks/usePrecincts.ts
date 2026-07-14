'use client'

import { api } from '@/lib/api/client'
import type { Precinct } from '@shared/lib/types/precinct'
import { useAsyncData } from './useAsyncData'

const EMPTY: Precinct[] = []

export interface UsePrecincts {
  precincts: Precinct[]
  isLoading: boolean
  error: string | null
}

export function usePrecincts(): UsePrecincts {
  const { data, isLoading, error } = useAsyncData<Precinct[]>(
    () => api.get<Precinct[]>('/api/v1/precincts'),
    EMPTY,
  )
  return { precincts: data, isLoading, error }
}
