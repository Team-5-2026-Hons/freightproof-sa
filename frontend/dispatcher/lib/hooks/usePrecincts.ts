'use client'

import { useEffect, useRef } from 'react'

import { api } from '@/lib/api/client'
import type { Precinct } from '@shared/lib/types/precinct'
import { useAsyncData } from './useAsyncData'

const EMPTY: Precinct[] = []

export interface UsePrecincts {
  precincts: Precinct[]
  isLoading: boolean
  // MUST be surfaced: callers fall back to an em-dash on a lookup miss, which renders a
  // failed fetch identically to a trip with genuinely no origin.
  error: string | null
  /** For manual refresh from the precincts pages; can't re-arm the one-shot retry below. */
  refetch: () => void
}

export function usePrecincts(): UsePrecincts {
  const { data, isLoading, error, refetch } = useAsyncData<Precinct[]>(
    () => api.get<Precinct[]>('/api/v1/precincts'),
    EMPTY,
  )

  // One automatic retry per failure, scoped to this hook rather than useAsyncData (which
  // backs every list — a blanket retry would double load on a struggling backend).
  // Resets on a completed SUCCESS, not on `error` clearing, or refetch() would re-arm it
  // on every failure and spin forever.
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
