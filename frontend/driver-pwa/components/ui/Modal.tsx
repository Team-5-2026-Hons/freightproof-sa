'use client'

import { type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const contentVariants = cva(
  cn(
    'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-modal',
    'w-[calc(100%-2rem)] rounded-xl bg-surface-container-lowest shadow-ambient p-0',
    'focus:outline-none',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
  ),
  {
    variants: {
      size: {
        sm: 'max-w-sm',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

interface ModalProps extends VariantProps<typeof contentVariants> {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 bg-black/40 z-modal',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <DialogPrimitive.Content className={cn(contentVariants({ size }))}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
            <DialogPrimitive.Title asChild>
              <h2 className="text-lg font-bold text-surface-on">{title}</h2>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              {/* w-11 (44px) meets the app's documented touch-target minimum (see
                  Button/IconButton/Switch) — the old w-8 (32px) was under it. -m-1.5
                  cancels the extra 12px so the layout box stays the 32px it always was:
                  header height and icon position are unchanged, only the tappable area
                  grows (the same pad-don't-grow pattern Switch documents). */}
              <button
                aria-label="Close modal"
                className="w-11 h-11 -m-1.5 flex items-center justify-center rounded-xl text-surface-on-variant hover:bg-surface-container-low transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="px-6 py-5 text-sm text-surface-on leading-relaxed">{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/20">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
