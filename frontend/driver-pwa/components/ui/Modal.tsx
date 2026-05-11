'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) { dialog.showModal() } else { dialog.close() }
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cn(
        'w-full m-auto rounded-xl bg-surface-container-lowest shadow-ambient p-0',
        'backdrop:bg-black/40',
        sizeClasses[size],
      )}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
        <h2 className="text-lg font-bold text-surface-on">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close modal"
          className="w-8 h-8 flex items-center justify-center rounded-xl text-surface-on-variant hover:bg-surface-container-low transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 py-5 text-sm text-surface-on leading-relaxed">{children}</div>

      {footer && (
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/20">
          {footer}
        </div>
      )}
    </dialog>
  )
}
