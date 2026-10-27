'use client'

import { useEffect, useRef } from 'react'

import { api } from '@/lib/api/client'
import type { Precinct } from '@shared/lib/types/precinct'
import { useAsyncData } from './useAsyncData'

const EMPTY: Precinct[] = []

export interface UsePrecincts {
  precincts: Precinct[]
  isLoading: boolean
  error: string | null
  /** For manual refresh from the precincts pages; can't re-arm the one-shot retry below. */
  refetch: () => void
}

export function usePrecincts(): UsePrecincts {
  const { data, isLoading, error, refetch } = useAsyncData<Precinct[]>(
    () => api.get<Precinct[]>('/api/v1/precincts'),
    EMPTY,
  )

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
