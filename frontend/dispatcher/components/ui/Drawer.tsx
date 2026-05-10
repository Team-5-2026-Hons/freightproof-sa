"use client"

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { Z } from '@shared/lib/z-index'

interface DrawerProps {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right' | 'bottom'
  children: React.ReactNode
  className?: string
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const panelClass = {
  left:   'inset-y-0 left-0 w-[320px] border-r-2',
  right:  'inset-y-0 right-0 w-[320px] border-l-2',
  bottom: 'inset-x-0 bottom-0 border-t-2 rounded-t-xl',
}

export function Drawer({ open, onClose, side = 'right', children, className }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement
    const panel = panelRef.current
    const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
    focusable[0]?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || focusable.length === 0) return
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0" style={{ zIndex: Z.overlay }}>
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.48)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          'absolute border-outline bg-surface-container-lowest',
          panelClass[side],
          className,
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="absolute right-4 top-4 rounded-md p-1 text-surface-on-variant hover:text-surface-on transition-colors"
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>
  )
}
