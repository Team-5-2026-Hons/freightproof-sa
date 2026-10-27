'use client'

import { api } from '@/lib/api/client'
import type { TripExceptionDetail } from '@shared/lib/types/exception'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import { useAsyncData } from './useAsyncData'

export interface UseExceptionDetailResult {
  exception: TripExceptionDetail | null
  isLoading: boolean
  error: string | null
  refetch: () => void
  refetchSilent: () => void
}

export function useExceptionDetail(exceptionId: string): UseExceptionDetailResult {
  const { data, isLoading, error, refetch, refetchSilent } = useAsyncData<TripExceptionDetail | null>(
    () => api.get<TripExceptionDetail>(`/api/v1/exceptions/${exceptionId}`),
    null,
  )

  useLiveResource('trip', data?.trip_id ?? '', refetchSilent, {
    kinds: ['exception_raised', 'exception_reviewed', 'exception_claimed'],
  })

  return { exception: data, isLoading, error, refetch, refetchSilent }
}
