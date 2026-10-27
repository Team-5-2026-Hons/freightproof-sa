'use client'

import { useEffect } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import { TRIP_RECORD_KINDS } from '@/lib/realtime/types'
import { useTripResource } from './useTripResource'

const ANCHOR_REFRESH_INTERVAL_MS = 10_000

export interface UseTripDetailResult {
  trip: Trip | null
  isLoading: boolean
  isValidating: boolean
  error: string | null
  errorStatus: number | null
  lastUpdated: number | null
  refetch: () => void
  refetchSilent: () => void
}

export function useTripDetail(tripId: string): UseTripDetailResult {
  const { data, ...resource } = useTripResource<Trip | null>(tripId, '', null, TRIP_RECORD_KINDS)
  const receiptOwed = data?.phases?.some(phase =>
    phase.completed_at !== null && phase.event_hash !== null
    && !phase.blockchain_receipt_id
    && (phase.anchor_status === 'pending' || phase.anchor_status === 'failed')) ?? false
  const { refetchSilent, isValidating } = resource
  useEffect(() => {
    if (!receiptOwed || isValidating) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refetchSilent()
    }, ANCHOR_REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [receiptOwed, isValidating, refetchSilent])
  return { trip: data, ...resource }
}
