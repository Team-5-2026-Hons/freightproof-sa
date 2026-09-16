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
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeDisabled?: boolean
}

const sizeClasses = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-6xl' }

// Whether (x, y) falls outside a bounding rectangle. Pulled out as a pure function so the
// "is this pointer on the backdrop" test lives in one obvious place rather than inline
// in the pointer handlers below.
function outsideDialog(rect: DOMRect, x: number, y: number): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
}

// A pointer gesture in progress: recorded on pointerdown, resolved on pointerup for the
// same pointerId. Why track the whole gesture instead of just the click target: a drag
// that starts on content inside the dialog (e.g. panning the Leaflet map in
// LocationComparisonMap) but is released over the backdrop still produces a native
// `click` whose target is the `<dialog>` element itself — indistinguishable from a real
// backdrop click by target alone. Only a gesture that both started and ended outside the
// dialog's own box counts as an intentional dismissal.
interface PointerGesture {
  pointerId: number
  downOutside: boolean
}

export function Modal({ open, onClose, title, children, footer, size = 'md', closeDisabled = false }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  // In-flight gesture, keyed by pointerId; cleared once resolved (pointerup/cancel) or
  // consumed (click). A ref, not state: this is bookkeeping for the next click, not
  // something a render should ever reflect.
  const gestureRef = useRef<PointerGesture | null>(null)
  // Whether the most recently resolved gesture qualifies as a genuine backdrop dismissal
  // (down outside AND up outside, same pointer). Read once by the click handler that
  // immediately follows pointerup, then reset — a click with no such gesture recorded
  // (e.g. a plain click with no preceding pointer events, or one already consumed) must
  // never dismiss.
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
      // Reset gesture bookkeeping on close/unmount: the component instance can persist
      // across `open` toggling back to true (this file returns null rather than
      // unmounting), so a gesture left over from before the modal closed must never leak
      // into the next time it opens.
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
    // Only a pointerup for the same pointerId that went down resolves that gesture; an
    // unrelated pointer's up (e.g. a second finger) must not complete it.
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
    // `target === currentTarget` alone (the pre-existing check) already rules out clicks
    // on inner content — only a native backdrop click, or a drag released over the
    // backdrop, targets the dialog element itself. The gesture flag added here is what
    // additionally rules out the drag case.
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
        'w-[calc(100%_-_2rem)] max-h-[90dvh] overflow-y-auto m-auto rounded-xl bg-surface-container-lowest shadow-ambient p-0',
        'backdrop:bg-black/40',
        sizeClasses[size],
      )}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20">
        <h2 id={titleId} className="text-lg font-bold text-surface-on">{title}</h2>
        <button
          type="button"
          disabled={closeDisabled}
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
