"use client"

import { createContext, useState, useCallback, useRef } from 'react'
import { ToastViewport, type ToastData } from '@/components/ui/Toast'

export type Toast = ToastData

export interface ToastState {
  toasts: Toast[]
  notify: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastState | null>(null)

const MAX_TOASTS = 3
// Info, success and warning auto-dismiss; error and explicitly sticky toasts require
// manual dismissal.
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
    // -1 means every toast on screen is critical, so fall back to age.
    const drop = oldestOrdinary === -1 ? 0 : oldestOrdinary
    kept = [...kept.slice(0, drop), ...kept.slice(drop + 1)]
  }
  return kept
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID()
    setToasts(prev => evictToCap([...prev, { ...toast, id }]))
    if (!toast.sticky && toast.kind !== 'error') {
      timers.current[id] = setTimeout(() => dismiss(id), TOAST_AUTO_DISMISS_MS)
    }
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toasts, notify, dismiss }}>
      {children}
      {/* ToastViewport handles positioning and aria-live per DESIGN_SYSTEM.md §10.7 */}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
