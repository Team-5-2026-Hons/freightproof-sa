'use client'

import type { Trip } from '@shared/lib/types/trip'
import { useTripResource } from './useTripResource'

export interface UseTripDetailResult {
  trip: Trip | null
  isLoading: boolean
  isValidating: boolean
  error: string | null
  errorStatus: number | null
  lastUpdated: number | null
  refetch: () => void
  // Refetches without flipping isLoading — used after a dispatcher mutation (cancel,
  // phase override) so the page's own content stays on screen instead of being
  // replaced by the full-page spinner mid-action.
  refetchSilent: () => void
}

export function useTripDetail(tripId: string): UseTripDetailResult {
  const { data, ...resource } = useTripResource<Trip | null>(tripId, '', null)
  return { trip: data, ...resource }
}
