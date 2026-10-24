"use client"

import { createContext, useState, useCallback } from 'react'
import { ToastViewport, type ToastData } from '@/components/ui/Toast'

export type { ToastData }

export interface ToastState {
  toasts: ToastData[]
  notify: (toast: Omit<ToastData, 'id'>) => void
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastState | null>(null)

const MAX_TOASTS = 3

// The same message, already on screen. Compared on everything the driver sees, so two
// different failures with the same title still both show.
function sameMessage(a: Omit<ToastData, 'id'>, b: Omit<ToastData, 'id'>): boolean {
  return a.kind === b.kind && a.title === b.title && a.body === b.body && a.sticky === b.sticky && a.anchor === b.anchor
}

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
    setToasts(prev => {
      // A retry loop or a double tap used to stack the same toast three deep and push
      // every other message off the screen. A repeat refreshes the one already showing
      // instead: a new object under the same id restarts its auto-dismiss timer without
      // replaying its entrance.
      const existing = prev.find(t => sameMessage(t, toast))
      if (existing !== undefined) return prev.map(t => (t === existing ? { ...t } : t))
      return [...prev, { ...toast, id: crypto.randomUUID() }].slice(-MAX_TOASTS)
    })
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, notify, dismiss }}>
      {children}
      {/* Toast viewport — top-anchored banner, full-width on mobile (moved up from the
          bottom corner, which collided with the nav pill and the swipe-to-confirm bar).
          It stacks itself (fixed, z-toast); a wrapper with a z-index of its own did nothing,
          since a static element creates no stacking context. */}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
