"use client"

import { createContext, useState, useCallback, useRef } from 'react'
import { ToastViewport, type ToastData } from '@/components/ui/Toast'
import { Z } from '@shared/lib/z-index'

export type { ToastData }

export interface ToastState {
  toasts: ToastData[]
  notify: (toast: Omit<ToastData, 'id'>) => void
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastState | null>(null)

const MAX_TOASTS = 3
// Auto-dismiss delay matches the ToastItem internal timer in Toast.tsx (4 000 ms).
// Kept here so ToastProvider can also track timers for dismiss() cancellation.
const AUTO_DISMISS_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const notify = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { ...toast, id }].slice(-MAX_TOASTS))
    if (!toast.sticky && toast.kind !== 'error') {
      timers.current[id] = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    }
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toasts, notify, dismiss }}>
      {children}
      {/* Toast viewport — bottom-left/right with margin, full-width on mobile per DESIGN_SYSTEM.md §10.7 */}
      <div style={{ zIndex: Z.toast }}>
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </div>
    </ToastContext.Provider>
  )
}
