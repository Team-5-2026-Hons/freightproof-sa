"use client"

import { createContext, useState, useCallback } from 'react'
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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  // Auto-dismiss is owned entirely by ToastItem (components/ui/Toast.tsx): its internal
  // timer plays the CSS leave transition, then calls this dismiss. A second provider-side
  // timer here used to call dismiss directly and unmount the item before its exit
  // animation could ever play — single ownership keeps the fade-out alive.
  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const notify = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { ...toast, id }].slice(-MAX_TOASTS))
  }, [])

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
