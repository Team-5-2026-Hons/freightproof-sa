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

  // There is no 'exception' realtime resource (lib/realtime/types.ts) — the stream only
  // carries trip-scoped events — so this subscribes to the TRIP the exception belongs
  // to, filtered down to the two kinds this record can change under. Before the fetch
  // resolves, `data` is null and the trip id is unknown; '' is a deliberate, harmless
  // placeholder (useLiveResource's own `id !== 'any' && event.id !== id` guard means no
  // real event will ever match it). Once `data.trip_id` arrives, this id argument
  // changes and useLiveResource's subscribe effect — keyed on `id` — re-subscribes
  // against the real trip automatically.
  useLiveResource('trip', data?.trip_id ?? '', refetchSilent, {
    kinds: ['exception_raised', 'exception_reviewed'],
  })

  return { exception: data, isLoading, error, refetch, refetchSilent }
}
