"use client"

import { useMemo } from 'react'
import type { TripException } from '@shared/lib/types/exception'
import { mockExceptions } from '@shared/lib/mocks/exceptions'

export interface ExceptionsFilter {
  resolved?: boolean
  tripId?: string
}

export function useExceptions(filter?: ExceptionsFilter): TripException[] {
  const resolved = filter?.resolved
  const tripId   = filter?.tripId

  return useMemo(() => {
    return mockExceptions.filter(e => {
      if (resolved !== undefined && e.resolved !== resolved) return false
      if (tripId !== undefined && e.trip_id !== tripId) return false
      return true
    })
  }, [resolved, tripId])
}
