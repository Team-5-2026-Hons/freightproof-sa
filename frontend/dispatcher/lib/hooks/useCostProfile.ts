'use client'

import { useCallback, useState } from 'react'

import { api } from '@/lib/api/client'
import type { CostProfile, CostProfileUpdate } from '@shared/lib/types/cost-analytics'

export const COST_PROFILE_PATH = '/api/v1/analytics/cost-profile'

export interface SaveCostRates {
  /** Resolves with the saved rates; rejects (and sets `error`) when the server refuses them. */
  save: (update: CostProfileUpdate) => Promise<CostProfile>
  isSaving: boolean
  error: string | null
  clearError: () => void
}

/** Saving an admin's change to the cost rates (FP-294). Reading them needs no hook: the
 *  Cost tab's figures carry the rates they were worked out with. */
export function useSaveCostRates(): SaveCostRates {
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async (update: CostProfileUpdate): Promise<CostProfile> => {
    setIsSaving(true)
    setError(null)
    try {
      return await api.patch<CostProfile>(COST_PROFILE_PATH, update)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [])

  const clearError = useCallback(() => setError(null), [])

  return { save, isSaving, error, clearError }
}
