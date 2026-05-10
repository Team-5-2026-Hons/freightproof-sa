"use client"

import { createContext, useState, useCallback, useRef } from 'react'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'warning' | 'error'
  title: string
  body?: string
  sticky?: boolean
}

export interface ToastState {
  toasts: Toast[]
  notify: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

export const ToastContext = createContext<ToastState | null>(null)

const MAX_TOASTS = 3
const AUTO_DISMISS_MS = 4000

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
    setToasts(prev => [...prev, { ...toast, id }].slice(-MAX_TOASTS))
    if (!toast.sticky && toast.kind !== 'error') {
      timers.current[id] = setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    }
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toasts, notify, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}
