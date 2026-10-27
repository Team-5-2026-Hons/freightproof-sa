'use client'

import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react'
import { X, Check, AlertTriangle, Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastData {
  id: string
  kind: ToastKind
  title: string
  body?: string
  sticky?: boolean
  anchor?: 'anchoring' | 'anchored'
}

interface ToastItemProps {
  toast: ToastData
  onDismiss: (id: string) => void
}

const kindConfig: Record<ToastKind, { icon: ReactNode; disc: string; role: 'status' | 'alert' }> = {
  info:    { icon: <Info className="size-5" strokeWidth={2.2} />,          disc: 'bg-fill text-surface-on',                    role: 'status' },
  success: { icon: <Check className="size-5" strokeWidth={2.6} />,         disc: 'bg-success-tint text-success-ink',           role: 'status' },
  warning: { icon: <AlertTriangle className="size-5" strokeWidth={2.2} />, disc: 'bg-attention-tint text-attention-ink',       role: 'status' },
  error:   { icon: <ShieldAlert className="size-5" strokeWidth={2.2} />,   disc: 'bg-error-tint text-error',                   role: 'alert'  },
}

function AnchorRow({ state }: { state: 'anchoring' | 'anchored' }) {
  const anchored = state === 'anchored'
  return (
    <div className="mt-3 grid grid-cols-[16px_1fr_auto] items-center gap-x-2.5 border-t border-hairline pt-3">
      <ShieldCheck aria-hidden className="size-4 text-chain" strokeWidth={2.4} />
      <div aria-hidden className="relative h-1 overflow-hidden rounded-full bg-chain-tint">
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full bg-chain',
            anchored ? 'w-full' : 'w-2/5 animate-anchor-slide motion-reduce:animate-none',
          )}
        />
      </div>
      <span className="text-footnote font-semibold text-chain">
        {anchored ? 'Anchored' : 'Anchoring…'}
        <span className="sr-only"> on Hedera</span>
      </span>
    </div>
  )
}

export const AUTO_DISMISS_MS = 4_000

const LEAVE_FALLBACK_MS = 200

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const { icon, disc, role } = kindConfig[toast.kind]
  const [leaving, setLeaving] = useState(false)
  const leaveFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startLeave = useCallback(() => {
    setLeaving(true)
    leaveFallbackRef.current = setTimeout(() => onDismiss(toast.id), LEAVE_FALLBACK_MS)
  }, [onDismiss, toast.id])

  useEffect(() => {
    if (toast.sticky || toast.kind === 'error') return
    const timer = setTimeout(startLeave, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast, startLeave])

  useEffect(() => {
    return () => {
      if (leaveFallbackRef.current) clearTimeout(leaveFallbackRef.current)
    }
  }, [])

  function handleTransitionEnd() {
    if (!leaving || leaveFallbackRef.current === null) return
    clearTimeout(leaveFallbackRef.current)
    leaveFallbackRef.current = null
    onDismiss(toast.id)
  }

  return (
    <div
      role={role}
      onTransitionEnd={handleTransitionEnd}
      className={cn(
        'w-full max-w-sm rounded-[22px] bg-surface px-4 py-3.5 shadow-ambient ring-1 ring-hairline',
        leaving
          ? 'opacity-0 -translate-y-2 transition-all duration-200 motion-reduce:transition-none'
          : 'animate-toast-in motion-reduce:animate-none',
      )}
    >
      <div className="grid grid-cols-[40px_1fr_auto] items-center gap-x-3">
        <span aria-hidden className={cn('flex size-10 items-center justify-center rounded-full', disc)}>{icon}</span>
        <div className="min-w-0">
          <p className="text-headline text-surface-on">{toast.title}</p>
          {toast.body && <p className="text-subhead tabular-nums text-surface-on-variant">{toast.body}</p>}
        </div>
        <button
          onClick={startLeave}
          aria-label="Dismiss notification"
          className="-m-2.5 flex size-11 shrink-0 items-center justify-center rounded-full text-surface-on-variant transition-colors active:bg-fill"
        >
          <X className="size-4" />
        </button>
      </div>
      {toast.anchor !== undefined && <AnchorRow state={toast.anchor} />}
    </div>
  )
}

interface ToastViewportProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'fixed inset-x-0 top-0 z-toast flex flex-col items-center gap-3',
        'px-4 sm:items-end sm:px-6',
        'pt-[calc(0.75rem+env(safe-area-inset-top))]',
      )}
    >
      {toasts.slice(0, 3).map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
