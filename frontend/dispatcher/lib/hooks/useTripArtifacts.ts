'use client'

import { useMemo } from 'react'
import { api } from '@/lib/api/client'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { useAsyncData } from './useAsyncData'

export interface UseTripArtifactsResult {
  artifacts: EvidenceArtifactWithUrl[]
  // Lookup by artifact id, because that is how phases reference their evidence:
  // PhaseDescriptor carries seal_photo_artifact_id and four siblings, and the list
  // itself carries no phase attribution.
  byId: Map<string, EvidenceArtifactWithUrl>
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useTripArtifacts(tripId: string): UseTripArtifactsResult {
  const { data, isLoading, error, refetch } = useAsyncData<EvidenceArtifactWithUrl[]>(
    () => api.get<EvidenceArtifactWithUrl[]>(`/api/v1/trips/${tripId}/artifacts`),
    [],
  )

  const byId = useMemo(
    () => new Map(data.map(a => [a.id, a])),
    [data],
  )

  return { artifacts: data, byId, isLoading, error, refetch }
}
