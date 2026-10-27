'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { isRecord } from '@/lib/api/json'

const PREFIX = 'exception-list-ui:'
const OWNER = `${PREFIX}owner`

type ExpandedGroups = Record<string, boolean>

interface Saved {
  scrollTop: number
  focusedId: string
  expanded: ExpandedGroups
}

/** Group expansion belongs to one user and one list view, so it is stored with the key it was
 *  made under. A different key means a different list, and its expansion starts empty. */
interface ExpandedState {
  key: string | null
  groups: ExpandedGroups
}

export interface ExceptionListRestorationOptions {
  userId: string | null
  origin: string
  container: RefObject<HTMLDivElement | null>
  ready: boolean
  identityReady?: boolean
}

function isSaved(value: unknown): value is Saved {
  if (!isRecord(value)) return false

  const { scrollTop, focusedId, expanded } = value
  if (typeof scrollTop !== 'number' || !Number.isFinite(scrollTop) || scrollTop < 0) return false
  if (typeof focusedId !== 'string') return false

  return isRecord(expanded) && Object.values(expanded).every(entry => typeof entry === 'boolean')
}

/** UI positions only. Storage may be blocked; navigation must always remain usable. */
export function useExceptionListRestoration({
  userId,
  origin,
  container,
  ready,
  identityReady = true,
}: ExceptionListRestorationOptions) {
  const key = userId ? `${PREFIX}${userId}:${origin}` : null
  const pending = useRef<Saved | null>(null)

  const [expandedState, setExpandedState] = useState<ExpandedState>({ key, groups: {} })
  if (expandedState.key !== key) setExpandedState({ key, groups: {} })

  const expanded = expandedState.groups
  const setExpanded: Dispatch<SetStateAction<ExpandedGroups>> = useCallback(next => {
    setExpandedState(current => ({
      key: current.key,
      groups: typeof next === 'function' ? next(current.groups) : next,
    }))
  }, [])

  useEffect(() => {
    pending.current = null
    if (!identityReady) return

    try {
      const previous = sessionStorage.getItem(OWNER)
      if (previous !== userId) {
        Object.keys(sessionStorage)
          .filter(storageKey => storageKey.startsWith(PREFIX))
          .forEach(storageKey => sessionStorage.removeItem(storageKey))
        if (userId) sessionStorage.setItem(OWNER, userId)
      }
      if (!key) return

      const raw = sessionStorage.getItem(key)
      if (!raw) return

      const value: unknown = JSON.parse(raw)
      if (!isSaved(value)) return

      pending.current = value
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(value.expanded)
    } catch { }
  }, [key, userId, identityReady, setExpanded])

  useEffect(() => {
    if (!ready || !pending.current || !container.current) return

    const saved = pending.current
    const frame = requestAnimationFrame(() => {
      const el = container.current
      if (!el) return

      pending.current = null
      el.scrollTop = saved.scrollTop

      const rows = Array.from(el.querySelectorAll<HTMLAnchorElement>('[data-exception-id]'))
        .filter(row => !row.closest('[hidden]'))
      const firstVisible = rows.find(row => row.getBoundingClientRect().bottom > el.getBoundingClientRect().top)
      const target = rows.find(row => row.dataset.exceptionId === saved.focusedId)
        ?? firstVisible
        ?? rows[0]
        ?? document.querySelector<HTMLElement>('[data-results-heading]')

      target?.focus({ preventScroll: true })
    })

    return () => cancelAnimationFrame(frame)
  }, [ready, container, key, expanded])

  const save = useCallback((focusedId: string): void => {
    if (!key || !identityReady) return

    const snapshot: Saved = { scrollTop: container.current?.scrollTop ?? 0, focusedId, expanded }
    try {
      sessionStorage.setItem(key, JSON.stringify(snapshot))
    } catch { }
  }, [key, container, expanded, identityReady])

  return { save, expanded, setExpanded }
}
