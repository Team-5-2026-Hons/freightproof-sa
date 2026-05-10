"use client"

import { X, CheckCircle2, AlertTriangle, Info, AlertOctagon } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import type { Toast as ToastData } from '@/lib/context/ToastContext'

interface ToastProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const kindClass: Record<ToastData['kind'], string> = {
  success: 'border-success text-success-on-container',
  info:    'border-outline text-surface-on',
  warning: 'border-tertiary text-tertiary-on-container',
  error:   'border-error text-error-on-container',
}

const KindIcon: Record<ToastData['kind'], React.ElementType> = {
  success: CheckCircle2,
  info:    Info,
  warning: AlertTriangle,
  error:   AlertOctagon,
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const Icon = KindIcon[toast.kind]
  const isError = toast.kind === 'error'

  return (
    <div
      role={isError ? 'alert' : undefined}
      aria-live={isError ? undefined : 'polite'}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border-2 bg-surface-container-lowest p-4 shadow-hard',
        kindClass[toast.kind],
      )}
    >
      <Icon size={20} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold leading-5">{toast.title}</p>
        {toast.body && (
          <p className="mt-0.5 text-[12px] leading-4 text-surface-on-variant">{toast.body}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md p-0.5 text-surface-on-variant hover:text-surface-on transition-colors"
      >
        <X size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  )
}
