// frontend/driver-pwa/lib/hooks/usePhaseDraft.ts
'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import { actorGeneration, captureCustody } from '@/lib/session/custody-context'
import { draftKey, migrateLegacyDrafts, readDraft, removeDraft, writeDraft } from '@/lib/offline/retained-drafts'

// Phase IDs distinguish repeated phases; actor/period distinguish successive capturers of
// the same pending phase. A mounted screen must apply the same boundary as a fresh mount.
export function usePhaseDraft<T extends object>(
  tripId: string,
  phaseEventId: string,
  initial: T,
): [draft: T, updateDraft: (patch: Partial<T>) => void, clearDraft: (acknowledgedDraft?: T) => void] {
  const { actorId, custodySequence } = captureCustody(tripId)
  const generation = actorGeneration()
  const scope = useMemo(() => ({ tripId, phaseEventId, actorId, custodySequence, generation }),
    [tripId, phaseEventId, actorId, custodySequence, generation])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const key = draftKey(tripId, phaseEventId)
  const revision = useRef<string | null>(null)

  const load = (): T => {
    try {
      migrateLegacyDrafts()
      const stored = readDraft(tripId, phaseEventId, scope)
      revision.current = localStorage.getItem(key)
      return stored !== null ? { ...initial, ...stored } : initial
    } catch (err) {
      console.warn(`usePhaseDraft: could not read draft for key "${key}"`, err)
      return initial
    }
  }
  const [state, setState] = useState(() => ({ scope, draft: load() }))
  let draft = state.draft
  if (state.scope !== scope) {
    // Adjust before children render: an effect would expose the old photo for one render.
    draft = load()
    setState({ scope, draft })
  }

  const isCurrentScope = useCallback((): boolean => {
    const live = captureCustody(tripId)
    return currentScope.current === scope && actorGeneration() === scope.generation
      && live.actorId === scope.actorId && live.custodySequence === scope.custodySequence
  }, [tripId, scope])

  const updateDraft = useCallback((patch: Partial<T>): void => {
    if (!isCurrentScope()) return
    setState(previous => {
      if (previous.scope !== scope || !isCurrentScope()) return previous
      const next = { ...previous.draft, ...patch }
      try {
        if (localStorage.getItem(key) !== revision.current) {
          console.warn('usePhaseDraft: a newer draft is stored; preserving it instead of applying a stale edit')
          return previous
        }
        // Persist in the updater: steps can update and navigate in the same event.
        writeDraft(tripId, phaseEventId, scope, next)
        revision.current = localStorage.getItem(key)
      } catch (err) {
        console.warn(`usePhaseDraft: failed to persist draft for key "${key}"`, err)
      }
      return { scope, draft: next }
    })
  }, [isCurrentScope, key, tripId, phaseEventId, scope])

  const clearRevision = revision.current
  const clearDraft = useCallback((acknowledgedDraft?: T): void => {
    if (!isCurrentScope()) return
    try {
      let expectedValue = clearRevision
      if (acknowledgedDraft !== undefined) {
        const raw = localStorage.getItem(key)
        if (raw === null) return
        const stored: unknown = JSON.parse(raw)
        if (typeof stored !== 'object' || stored === null || !('draft' in stored)
            || typeof stored.draft !== 'object' || stored.draft === null) return
        // The submitted value may include defaults absent from a legacy stored shape.
        // Compare evidence as submitted so a later edit in this same period survives.
        if (JSON.stringify({ ...initial, ...stored.draft }) !== JSON.stringify({ ...initial, ...acknowledgedDraft })) return
        expectedValue = raw
      }
      if (localStorage.getItem(key) !== expectedValue) return
      removeDraft(tripId, phaseEventId, scope, expectedValue)
      revision.current = localStorage.getItem(key)
    } catch (err) {
      console.warn(`usePhaseDraft: failed to clear stored draft for key "${key}"`, err)
    }
    setState({ scope, draft: initial })
  }, [isCurrentScope, key, tripId, phaseEventId, scope, initial, clearRevision])

  return [draft, updateDraft, clearDraft]
}
