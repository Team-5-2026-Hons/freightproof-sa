'use client'

import { useEffect, type ReactNode } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X, CheckCircle2, AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastData {
  id: string
  kind: ToastKind
  title: string
  body?: string
  sticky?: boolean
}

interface ToastItemProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const kindConfig: Record<ToastKind, { icon: ReactNode; accent: string; role: 'status' | 'alert' }> = {
  info:    { icon: <Info className="w-4 h-4 text-secondary shrink-0" />,       accent: 'border-secondary/20',  role: 'status' },
  success: { icon: <CheckCircle2 className="w-4 h-4 text-success shrink-0" />, accent: 'border-success/20',   role: 'status' },
  warning: { icon: <AlertTriangle className="w-4 h-4 text-tertiary shrink-0" />, accent: 'border-tertiary/20', role: 'status' },
  error:   { icon: <ShieldAlert className="w-4 h-4 text-error shrink-0" />,    accent: 'border-error/20',      role: 'alert'  },
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const { icon, accent, role } = kindConfig[toast.kind]
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (toast.sticky || toast.kind === 'error') return
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast, onDismiss])

  return (
    <motion.div
      role={role}
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'flex items-start gap-3 w-full max-w-sm px-4 py-3 pr-3',
        'bg-surface-container-lowest rounded-xl shadow-ambient',
        'border border-outline-variant/20',
        accent,
      )}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-surface-on">{toast.title}</p>
        {toast.body && <p className="text-xs text-surface-on-variant mt-0.5 leading-relaxed">{toast.body}</p>}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="w-6 h-6 flex items-center justify-center rounded-lg text-surface-on-variant hover:bg-surface-container-low shrink-0 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  )
}

interface ToastViewportProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

// Render once inside ToastProvider. Consumers call useToast().notify() — never render this directly.
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-6 right-6 z-[80] flex flex-col gap-3 items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.slice(0, 3).map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  )
}
