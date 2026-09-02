'use client'

import { useEffect, useRef } from 'react'

import { api } from '@/lib/api/client'
import type { Precinct } from '@shared/lib/types/precinct'
import { useAsyncData } from './useAsyncData'

const EMPTY: Precinct[] = []

export interface UsePrecincts {
  precincts: Precinct[]
  isLoading: boolean
  // MUST be surfaced by callers. Precinct names are looked up by id, and every
  // call site falls back to an em-dash when the lookup misses — which renders a
  // FAILED fetch identically to a trip that genuinely has no origin. A transient
  // failure here once read as missing trip data for exactly that reason.
  error: string | null
  // Exposed so a mutation on the precincts pages can refresh the list in place. The
  // one-shot retry below is unaffected: it resets only on a completed success, so a
  // manual refetch cannot re-arm it.
  refetch: () => void
}

export function usePrecincts(): UsePrecincts {
  const { data, isLoading, error, refetch } = useAsyncData<Precinct[]>(
    () => api.get<Precinct[]>('/api/v1/precincts'),
    EMPTY,
  )

  // Exactly one automatic retry per failure, scoped to THIS hook rather than added to
  // useAsyncData — that hook backs every list on the dispatcher, and a blanket retry
  // would double the load of every screen on a backend that is already struggling
  // whenever this fires. api.get retries only a DROPPED connection (client.ts send());
  // a timeout or a 5xx gets no second attempt, and those are the shapes seen here.
  //
  // The flag resets on a completed SUCCESS, not merely on `error` clearing: refetch()
  // nulls the error synchronously, so resetting on `error === null` alone would re-arm
  // the retry on every failure and spin forever.
  const retriedRef = useRef(false)
  useEffect(() => {
    if (isLoading) return
    if (error === null) {
      retriedRef.current = false
      return
    }
    if (retriedRef.current) return
    retriedRef.current = true
    refetch()
  }, [error, isLoading, refetch])

  return { precincts: data, isLoading, error, refetch }
}
