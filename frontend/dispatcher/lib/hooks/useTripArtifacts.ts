'use client'

import { useMemo } from 'react'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { useTripResource } from './useTripResource'

export interface UseTripArtifactsResult {
  artifacts: EvidenceArtifactWithUrl[]
  byId: Map<string, EvidenceArtifactWithUrl>
  isLoading: boolean
  isValidating: boolean
  error: string | null
  errorStatus: number | null
  lastUpdated: number | null
  refetch: () => void
  refetchSilent: () => void
}

const EMPTY_ARTIFACTS: EvidenceArtifactWithUrl[] = []

export function useTripArtifacts(tripId: string): UseTripArtifactsResult {
  const { data, ...resource } = useTripResource<EvidenceArtifactWithUrl[]>(tripId, '/artifacts', EMPTY_ARTIFACTS)
  const byId = useMemo(() => new Map(data.map(artifact => [artifact.id, artifact])), [data])
  return { artifacts: data, byId, ...resource }
}
