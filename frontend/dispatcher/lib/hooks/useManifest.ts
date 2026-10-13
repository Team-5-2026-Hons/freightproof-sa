'use client'

import type { Manifest } from '@shared/lib/types/manifest'
import { TRIP_RECORD_KINDS } from '@/lib/realtime/types'
import { useTripResource } from './useTripResource'

export interface UseManifestResult {
  manifest: Manifest | null
  isLoading: boolean
  isValidating: boolean
  error: string | null
  errorStatus: number | null
  lastUpdated: number | null
  refetch: () => void
  refetchSilent: () => void
}

/** A 404 means no manifest yet; other failures must remain recoverable errors. */
export function useManifest(tripId: string): UseManifestResult {
  const { data, ...resource } = useTripResource<Manifest | null>(tripId, '/manifest', null, TRIP_RECORD_KINDS)
  return { manifest: data, ...resource }
}
