'use client'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
const PREFIX = 'exception-list-ui:'
const OWNER = `${PREFIX}owner`
interface Saved { scrollTop: number; focusedId: string; expanded: Record<string, boolean> }
/** UI positions only. Storage may be blocked; navigation must always remain usable. */
export function useExceptionListRestoration(userId: string | null, origin: string, container: RefObject<HTMLDivElement | null>, ready: boolean, identityReady = true) {
  const key = userId ? `${PREFIX}${userId}:${origin}` : null
  const pending = useRef<Saved | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  useEffect(() => {
    pending.current = null
    // Reset on identity/query changes so another user's expansion is never reused.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded({})
    if (!identityReady) return
    try {
      const previous = sessionStorage.getItem(OWNER)
      if (previous !== userId) {
        Object.keys(sessionStorage).filter(k => k.startsWith(PREFIX)).forEach(k => sessionStorage.removeItem(k))
        if (userId) sessionStorage.setItem(OWNER, userId)
      }
      if (!key) return
      const raw = sessionStorage.getItem(key)
      if (!raw) return
      const value: unknown = JSON.parse(raw)
      if (typeof value !== 'object' || !value) return
      const saved = value as Partial<Saved>
      if (typeof saved.scrollTop !== 'number' || !Number.isFinite(saved.scrollTop) || saved.scrollTop < 0 || typeof saved.focusedId !== 'string') return
      const entries = saved.expanded && typeof saved.expanded === 'object' ? Object.entries(saved.expanded).filter(([,v]) => typeof v === 'boolean') : []
      pending.current = { scrollTop: saved.scrollTop, focusedId: saved.focusedId, expanded: Object.fromEntries(entries) }
      setExpanded(pending.current.expanded)
    } catch { /* Unavailable storage degrades only restoration, never navigation. */ }
  }, [key, userId, identityReady])
  useEffect(() => {
    if (!ready || !pending.current || !container.current) return
    const saved = pending.current
    const frame = requestAnimationFrame(() => {
      const el = container.current
      if (!el) return
      pending.current = null
      el.scrollTop = saved.scrollTop
      const rows = Array.from(el.querySelectorAll<HTMLAnchorElement>('[data-exception-id]')).filter(row => !row.closest('[hidden]'))
      const firstVisible = rows.find(row => row.getBoundingClientRect().bottom > el.getBoundingClientRect().top)
      const target = rows.find(row => row.dataset.exceptionId === saved.focusedId) ?? firstVisible ?? rows[0] ?? document.querySelector<HTMLElement>('[data-results-heading]')
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [ready, container, key, expanded])
  const save = useCallback((focusedId: string): void => {
    if (!key || !identityReady) return
    try { sessionStorage.setItem(key, JSON.stringify({ scrollTop: container.current?.scrollTop ?? 0, focusedId, expanded })) }
    catch { /* Browser privacy settings can reject storage; the link still works. */ }
  }, [key, container, expanded, identityReady])
  return { save, expanded, setExpanded }
}
