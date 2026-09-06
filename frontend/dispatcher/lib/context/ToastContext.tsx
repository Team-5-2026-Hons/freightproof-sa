"use client"

import { createContext, useState, useCallback, useRef } from 'react'
import { ToastViewport, type ToastData } from '@/components/ui/Toast'

// Re-export ToastData as Toast for backwards-compat with useToast consumers
export type Toast = ToastData

export interface ToastState {
  toasts: Toast[]
  notify: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastState | null>(null)

const MAX_TOASTS = 3
// info and success auto-dismiss; error and sticky require manual dismiss.
const AUTO_DISMISS_MS = 4000

/**
 * Drop toasts until the viewport can hold what is left, lowest priority first.
 *
 * This was `slice(-MAX_TOASTS)`, which discards the OLDEST whatever it says — so three
 * routine alerts landing behind a panic button pushed the hijacking off the dispatcher's
 * screen, and ranking.ts's severity split bought nothing at all. A component rendering
 * one toast cannot see what else arrived; this is the only place that can weigh them.
 *
 * Age still decides within a band: priority is a tiebreak on top of the existing rule,
 * not a replacement for it. A critical can still be displaced by a NEWER critical —
 * the list has to stay bounded, and between two live incidents the one nobody has read
 * yet is the one to show.
 */
function evictToCap(toasts: Toast[]): Toast[] {
  let kept = toasts
  while (kept.length > MAX_TOASTS) {
    const oldestOrdinary = kept.findIndex(t => t.priority !== 'critical')
    // -1 means every toast on screen is critical, so age is all that is left to go on.
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
      timers.current[id] = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
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
