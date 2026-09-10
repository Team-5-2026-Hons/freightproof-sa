'use client'

import { useMemo } from 'react'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import { useTripResource } from './useTripResource'

export interface UseTripArtifactsResult {
  artifacts: EvidenceArtifactWithUrl[]
  // Lookup by artifact id, because that is how phases reference their evidence:
  // PhaseDescriptor carries seal_photo_artifact_id and four siblings, and the list
  // itself carries no phase attribution.
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
