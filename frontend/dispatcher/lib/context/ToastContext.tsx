"use client"

import { createContext, useState, useCallback, useRef } from 'react'
import { ToastViewport, type ToastData } from '@/components/ui/Toast'

export type Toast = ToastData

export interface ToastState {
  toasts: Toast[]
  notify: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
  /** Drops every toast and cancels their timers. */
  clear: () => void
}

export const ToastContext = createContext<ToastState | null>(null)

const MAX_TOASTS = 3
export const TOAST_AUTO_DISMISS_MS = 4_000

/**
 * Drop toasts until the viewport can hold what's left, lowest priority first. Priority
 * is a tiebreak on top of age, not a replacement for it — a critical can still be
 * displaced by a NEWER critical, since the list has to stay bounded.
 */
function evictToCap(toasts: Toast[]): Toast[] {
  let kept = toasts
  while (kept.length > MAX_TOASTS) {
    const oldestOrdinary = kept.findIndex(t => t.priority !== 'critical')
    const drop = oldestOrdinary === -1 ? 0 : oldestOrdinary
    kept = [...kept.slice(0, drop), ...kept.slice(drop + 1)]
  }
  return kept
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const current = useRef<Toast[]>([])

  const commit = useCallback((next: Toast[]) => {
    current.current = next
    setToasts(next)
  }, [])

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    commit(current.current.filter(t => t.id !== id))
  }, [commit])

  const clear = useCallback(() => {
    if (current.current.length === 0) return
    Object.values(timers.current).forEach(clearTimeout)
    timers.current = {}
    commit([])
  }, [commit])

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const duplicate = current.current.some(
      t => t.kind === toast.kind && t.title === toast.title && t.body === toast.body,
    )
    if (duplicate) return
    const id = crypto.randomUUID()
    commit(evictToCap([...current.current, { ...toast, id }]))
    if (!toast.sticky && toast.kind !== 'error') {
      timers.current[id] = setTimeout(() => dismiss(id), TOAST_AUTO_DISMISS_MS)
    }
  }, [commit, dismiss])

  return (
    <ToastContext.Provider value={{ toasts, notify, dismiss, clear }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
