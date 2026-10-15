'use client'

import { type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  /** A 48px disc above the title that says, before any words, what kind of moment this is. */
  icon?: ReactNode
  /** One line under the title. */
  description?: ReactNode
  children?: ReactNode
  /** Actions, stacked full width — the primary first. */
  footer?: ReactNode
  /**
   * Set false to remove every path a driver could use to dismiss the modal without
   * choosing an outcome — Escape, overlay click, and the close X all stop firing
   * onClose. Defaults to true. Introduced for LocationCheckModal, whose two actions
   * (Retry / Continue) are both recorded choices — a stray dismiss must not silently
   * drop the driver back onto the step.
   */
  dismissible?: boolean
}

/**
 * A decision the driver must make before going on, as a floating sheet (overhaul 4.2): an
 * inset card at the bottom of the screen, where the thumb already is, over a dimmed page.
 * Unlike Drawer it has no drag-to-dismiss — its one caller is non-dismissible on purpose.
 */
export function Modal({ open, onClose, title, icon, description, children, footer, dismissible = true }: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next && dismissible) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-black/40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-x-2 bottom-[max(env(safe-area-inset-bottom),0.5rem)] z-modal mx-auto max-w-lg',
            'max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-[32px] bg-surface px-5 pb-[22px] pt-6 shadow-ambient',
            'focus:outline-none animate-sheet-up motion-reduce:animate-none',
          )}
          // Radix warns when a dialog has no description; when there is none, say so
          // explicitly rather than leave it pointing at a missing id.
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          // Belt-and-braces alongside the missing Close button below: onOpenChange alone
          // stops onClose from firing, but Radix's DismissableLayer still intercepts
          // Escape/outside-pointer events first — preventDefault on all three is what
          // actually keeps the dialog's own open/closed state from moving at all.
          onEscapeKeyDown={(event) => { if (!dismissible) event.preventDefault() }}
          onPointerDownOutside={(event) => { if (!dismissible) event.preventDefault() }}
          onInteractOutside={(event) => { if (!dismissible) event.preventDefault() }}
        >
          <div className="flex items-start justify-between gap-3">
            {icon !== undefined ? <span className="flex size-12 shrink-0 items-center justify-center rounded-full">{icon}</span> : <span />}
            {dismissible && (
              <DialogPrimitive.Close asChild>
                <button
                  aria-label="Close modal"
                  className="-mr-1 -mt-1 flex size-11 items-center justify-center rounded-full bg-fill text-surface-on-variant"
                >
                  <X className="size-5" strokeWidth={2} />
                </button>
              </DialogPrimitive.Close>
            )}
          </div>
          <DialogPrimitive.Title asChild>
            <h2 className={cn('text-title-2 text-surface-on', icon !== undefined && 'mt-3.5')}>{title}</h2>
          </DialogPrimitive.Title>
          {description !== undefined && (
            <DialogPrimitive.Description asChild>
              <p className="mt-1.5 text-subhead text-surface-on-variant">{description}</p>
            </DialogPrimitive.Description>
          )}

          {children !== undefined && <div className="mt-4 text-body text-surface-on">{children}</div>}

          {footer !== undefined && <div className="mt-4 flex flex-col gap-2.5">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
