'use client'

import {
  useEffect,
  useId,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'zoom'
  closeDisabled?: boolean
  backdrop?: 'dim' | 'blur'
}

const sizeClasses = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-6xl', zoom: 'max-w-none' }
const FITTED_MAX_HEIGHT = 'max-h-[90dvh]'
const FITTED_BOX = `w-[calc(100%_-_2rem)] ${FITTED_MAX_HEIGHT}`
const ZOOM_BOX = 'w-[80vw] h-[80dvh] max-h-[80dvh]'
const BACKDROP_CLASSES = { dim: 'backdrop:bg-black/40', blur: 'backdrop:bg-black/30 backdrop:backdrop-blur-sm' }

function outsideDialog(rect: DOMRect, x: number, y: number): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
}

interface PointerGesture {
  pointerId: number
  downOutside: boolean
}

export function Modal({ open, onClose, title, children, footer, size = 'md', closeDisabled = false, backdrop = 'dim' }: ModalProps) {
  const isZoom = size === 'zoom'
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const gestureRef = useRef<PointerGesture | null>(null)
  const dismissGestureRef = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    return () => {
      dialog.close()
      trigger?.focus()
      gestureRef.current = null
      dismissGestureRef.current = false
    }
  }, [open])

  if (!open) return null

  function handlePointerDown(event: ReactPointerEvent<HTMLDialogElement>): void {
    const dialog = dialogRef.current
    if (!dialog) return
    const rect = dialog.getBoundingClientRect()
    gestureRef.current = {
      pointerId: event.pointerId,
      downOutside: outsideDialog(rect, event.clientX, event.clientY),
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDialogElement>): void {
    const dialog = dialogRef.current
    const gesture = gestureRef.current
    if (!dialog || !gesture || gesture.pointerId !== event.pointerId) {
      dismissGestureRef.current = false
      return
    }
    const rect = dialog.getBoundingClientRect()
    const upOutside = outsideDialog(rect, event.clientX, event.clientY)
    dismissGestureRef.current = gesture.downOutside && upOutside
    gestureRef.current = null
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDialogElement>): void {
    if (gestureRef.current?.pointerId === event.pointerId) {
      gestureRef.current = null
    }
    dismissGestureRef.current = false
  }

  function handleClick(event: ReactMouseEvent<HTMLDialogElement>): void {
    const shouldClose = event.target === event.currentTarget && !closeDisabled && dismissGestureRef.current
    dismissGestureRef.current = false
    if (shouldClose) onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); if (!closeDisabled) onClose() }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      className={cn(
        isZoom ? ZOOM_BOX : FITTED_BOX,
        'overflow-hidden m-auto rounded-xl bg-surface-container-lowest shadow-ambient p-0',
        'focus-visible:outline-none',
        BACKDROP_CLASSES[backdrop],
        sizeClasses[size],
      )}
    >
      <div className={cn('flex flex-col', isZoom ? 'h-full' : FITTED_MAX_HEIGHT)}>
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4 border-b border-outline-variant/20">
          <h2 id={titleId} className="min-w-0 break-words text-lg font-bold text-surface-on">{title}</h2>
          <button
            type="button"
            disabled={closeDisabled}
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-surface-on-variant hover:bg-surface-container-low transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sm text-surface-on leading-relaxed">
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/20">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  )
}
