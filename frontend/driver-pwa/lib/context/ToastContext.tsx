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

function sameMessage(a: Omit<ToastData, 'id'>, b: Omit<ToastData, 'id'>): boolean {
  return a.kind === b.kind && a.title === b.title && a.body === b.body && a.sticky === b.sticky && a.anchor === b.anchor
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const notify = useCallback((toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => {
      const existing = prev.find(t => sameMessage(t, toast))
      if (existing !== undefined) return prev.map(t => (t === existing ? { ...t } : t))
      return [...prev, { ...toast, id: crypto.randomUUID() }].slice(-MAX_TOASTS)
    })
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, notify, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}
