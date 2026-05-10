"use client"

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
import { Z } from '@shared/lib/z-index'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    focusable[0]?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || focusable.length === 0) return
      const first = focusable[0]; const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocusRef.current?.focus() }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ zIndex: Z.modal }}>
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.48)' }} onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          'relative w-full rounded-t-xl border-2 border-outline bg-surface-container-lowest shadow-hard-lg sm:max-w-[560px] sm:rounded-xl',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b-2 border-outline px-4 py-4">
          <h2 id="modal-title" className="text-[22px] font-semibold leading-7 text-surface-on">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-surface-on-variant hover:text-surface-on">
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <div className="p-4 text-[16px] leading-6 text-surface-on">{children}</div>
        {footer && <div className="flex flex-col gap-3 border-t-2 border-outline px-4 py-4">{footer}</div>}
      </div>
    </div>
  )
}
