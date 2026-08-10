'use client'

import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react'
import { X, CheckCircle2, AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

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

// Fallback delay if the exit transition's `transitionend` never fires (e.g. a parent
// re-render removes the element from the DOM before the browser dispatches it) — matches
// the leave transition's own duration below so a stuck toast never lingers past it.
const LEAVE_FALLBACK_MS = 200

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const { icon, accent, role } = kindConfig[toast.kind]
  // Local exit state: dismissal plays a CSS transition before the toast actually leaves
  // the parent's toast list — onDismiss (which unmounts this item) is deferred to
  // handleTransitionEnd or the fallback timeout below, not called synchronously.
  const [leaving, setLeaving] = useState(false)
  const leaveFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startLeave = useCallback(() => {
    setLeaving(true)
    leaveFallbackRef.current = setTimeout(() => onDismiss(toast.id), LEAVE_FALLBACK_MS)
  }, [onDismiss, toast.id])

  useEffect(() => {
    if (toast.sticky || toast.kind === 'error') return
    const timer = setTimeout(startLeave, 4000)
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
        'flex items-start gap-3 w-full max-w-sm px-4 py-3 pr-3',
        'bg-surface-container-lowest rounded-xl shadow-ambient',
        'border border-outline-variant/20',
        leaving
          // Leaves the way it arrived — upward, back off the top of the screen. motion-
          // reduce: no transition, so the toast just goes transparent and the 200ms
          // fallback timer removes it (transitionend never fires without a transition, so
          // removal relies on the fallback path there).
          ? 'opacity-0 -translate-y-2 transition-all duration-200 motion-reduce:transition-none'
          : 'animate-toast-in motion-reduce:animate-none',
        accent,
      )}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-surface-on">{toast.title}</p>
        {toast.body && <p className="text-xs text-surface-on-variant mt-0.5 leading-relaxed">{toast.body}</p>}
      </div>
      {/* w-11 (44px) meets the app's documented touch-target minimum (see Button/
          IconButton/Switch) — critical here because sticky/error toasts never
          auto-dismiss, so this button is their ONLY exit, and it was 24px. -m-2.5
          cancels the extra 20px so the layout box stays the 24px it always was: the
          toast's visual footprint doesn't inflate, the hit area just bleeds ~10px
          into the surrounding padding/content (the pad-don't-grow pattern Switch
          documents). Icon stays w-3 h-3 so the glyph doesn't shout over the message. */}
      <button
        onClick={startLeave}
        aria-label="Dismiss notification"
        className="w-11 h-11 -m-2.5 flex items-center justify-center rounded-lg text-surface-on-variant hover:bg-surface-container-low shrink-0 transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
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
      className={cn(
        // Top-anchored: these messages are mostly failures ("Couldn't open this trip",
        // "Check your connection"), and at the bottom they surfaced in the same corner of
        // the screen as the floating BottomNav and SwipeToConfirm — the two controls a
        // driver's hand is already covering. Dropping in from the top puts them where
        // nothing else lives and nothing is holding a thumb.
        'fixed inset-x-0 top-0 z-toast flex flex-col items-center gap-3',
        'px-4 sm:items-end sm:px-6',
        // env() clears the notch / status bar the same way AppShell's header does — under
        // viewportFit:'cover' a plain pt-3 would render the first toast behind it.
        'pt-[calc(0.75rem+env(safe-area-inset-top))]',
      )}
    >
      {toasts.slice(0, 3).map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
