'use client'

import { api } from '@/lib/api/client'
import type { Manifest } from '@shared/lib/types/manifest'
import { useAsyncData } from './useAsyncData'

export interface UseManifestResult {
  manifest: Manifest | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

/**
 * GET /trips/{id}/manifest, dispatcher shape.
 *
 * The endpoint 404s before loading has started, which is a legitimate state and not a
 * failure — the panel presents it as "no manifest pulled yet" regardless of whether the
 * cause was a 404 or another fetch error, since neither is actionable from here.
 */
export function useManifest(tripId: string): UseManifestResult {
  const { data, isLoading, error, refetch } = useAsyncData<Manifest | null>(
    () => api.get<Manifest>(`/api/v1/trips/${tripId}/manifest`),
    null,
  )
  return { manifest: data, isLoading, error, refetch }
}
