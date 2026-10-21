'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { actorGeneration } from './custody-context'

/** A callback belongs to this account/session even after React has rendered its successor. */
export function useAccountGuard(actorId: string | null): () => boolean {
  const generation = actorGeneration()
  const scope = useMemo(() => ({ actorId, generation }), [actorId, generation])
  const current = useRef(scope)
  current.current = scope
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  return useCallback(() => mounted.current && current.current === scope
    && actorGeneration() === scope.generation, [scope])
}
