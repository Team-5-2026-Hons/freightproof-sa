'use client'

import { useCallback } from 'react'

import { api } from '@/lib/api/client'
import type { PrecinctDetail } from '@shared/lib/types/precinct'
import { useAsyncData } from './useAsyncData'

export interface UsePrecinctDetail {
  precinct: PrecinctDetail | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function usePrecinctDetail(precinctId: string): UsePrecinctDetail {
  const fetcher = useCallback(
    () => api.get<PrecinctDetail>(`/api/v1/precincts/${precinctId}`),
    [precinctId],
  )
  const { data, isLoading, error, refetch } = useAsyncData<PrecinctDetail | null>(fetcher, null)

  return { precinct: data, isLoading, error, refetch }
}
