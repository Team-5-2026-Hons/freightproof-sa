'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SPRING_FLICK, SPRING_SETTLE, animateSpring, projectMomentum, rubberband } from '@/lib/motion/spring'

interface DrawerProps {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right' | 'bottom'
  children: ReactNode
  title?: string
}

const panelClasses = {
  left:   { container: 'left-0 top-0 h-full w-80',                          open: 'translate-x-0', closed: '-translate-x-full' },
  right:  { container: 'right-0 top-0 h-full w-80',                         open: 'translate-x-0', closed: 'translate-x-full'  },
  bottom: { container: 'bottom-0 left-0 w-full rounded-t-3xl max-h-[85vh]', open: 'translate-y-0', closed: 'translate-y-full'  },
}

const DISMISS_FRACTION = 0.5
const OVERPULL_LIMIT_PX = 24
const VELOCITY_WINDOW_MS = 100
const MIN_VELOCITY_SPAN_MS = 16
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [role="button"]'

const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

interface DragSample {
  y: number
  t: number
}

export function Drawer({ open, onClose, side = 'right', children, title }: DrawerProps) {
  const titleId = useId()
  const [dragOwned, setDragOwned] = useState(false)
  const dragOffsetRef = useRef(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scrimRef = useRef<HTMLDivElement | null>(null)
  const startYRef = useRef(0)
  const samplesRef = useRef<DragSample[]>([])
  const isDraggingRef = useRef(false)
  const cancelSpringRef = useRef<(() => void) | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  useEffect(() => {
    const panel = panelRef.current
    if (!open || panel === null) return
    const previous = document.activeElement
    returnFocusRef.current = previous instanceof HTMLElement ? previous : null
    const [first] = focusableWithin(panel)
    ;(first ?? panel).focus({ preventScroll: true })
    return () => {
      const target = returnFocusRef.current
      returnFocusRef.current = null
      if (target !== null && target.isConnected) target.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    const panel = panelRef.current
    if (!open || panel === null) return
    const keepGestureOnSheet = (e: TouchEvent) => {
      if (panel.scrollHeight > panel.clientHeight) return
      e.preventDefault()
    }
    panel.addEventListener('touchmove', keepGestureOnSheet, { passive: false })
    return () => panel.removeEventListener('touchmove', keepGestureOnSheet)
  }, [open])

  useEffect(() => () => cancelSpringRef.current?.(), [])

  useLayoutEffect(() => {
    if (dragOwned) return
    const panel = panelRef.current
    const scrim = scrimRef.current
    if (panel !== null) panel.style.transform = ''
    if (scrim !== null) {
      scrim.style.opacity = ''
      scrim.style.transition = ''
    }
  }, [dragOwned])

  const applyOffset = useCallback((value: number) => {
    dragOffsetRef.current = value
    const panel = panelRef.current
    if (panel === null) return
    panel.style.transform = `translateY(${value}px)`
    const scrim = scrimRef.current
    const height = panel.offsetHeight
    if (scrim !== null && height > 0) {
      scrim.style.transition = 'none'
      scrim.style.opacity = String(Math.max(0, 1 - Math.max(value, 0) / height))
    }
  }, [])

  const isSheet = side === 'bottom'

  const settleTo = useCallback((target: number, velocity: number, dismiss: boolean) => {
    cancelSpringRef.current?.()
    const finish = () => {
      cancelSpringRef.current = null
      if (dismiss) onClose()
      setDragOwned(false)
    }
    if (prefersReducedMotion()) {
      finish()
      return
    }
    cancelSpringRef.current = animateSpring({
      from: dragOffsetRef.current,
      to: target,
      velocity,
      config: dismiss ? SPRING_SETTLE : SPRING_FLICK,
      onUpdate: applyOffset,
      onComplete: finish,
    })
  }, [onClose, applyOffset])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isSheet || !open) return
    if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR) !== null) return
    cancelSpringRef.current?.()
    cancelSpringRef.current = null
    isDraggingRef.current = true
    if (!dragOwned) {
      applyOffset(0)
      setDragOwned(true)
    }
    startYRef.current = e.clientY - dragOffsetRef.current
    samplesRef.current = [{ y: dragOffsetRef.current, t: performance.now() }]
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    const raw = e.clientY - startYRef.current
    const next = raw >= 0 ? raw : -rubberband(-raw, OVERPULL_LIMIT_PX)
    applyOffset(next)
    const now = performance.now()
    samplesRef.current = [...samplesRef.current, { y: next, t: now }].filter((s) => now - s.t <= VELOCITY_WINDOW_MS)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)

    const samples = samplesRef.current
    const first = samples[0]
    const last = samples[samples.length - 1]
    const span = last.t - first.t
    const velocity = samples.length < 2 || span < MIN_VELOCITY_SPAN_MS ? 0 : ((last.y - first.y) / span) * 1000

    const height = panelRef.current?.offsetHeight ?? 0
    const projected = dragOffsetRef.current + projectMomentum(velocity)
    const dismiss = height > 0 && projected > height * DISMISS_FRACTION
    settleTo(dismiss ? height : 0, velocity, dismiss)
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    settleTo(0, 0, false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !open) return
    const focusable = focusableWithin(e.currentTarget)
    if (focusable.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const { container, open: openClass, closed } = panelClasses[side]

  return (
    <>
      <div
        ref={scrimRef}
        className={cn(
          'fixed inset-0 z-overlay touch-none bg-black/40 transition-opacity duration-300 motion-reduce:transition-none',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
        role="dialog"
        aria-modal={open ? true : undefined}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={open ? -1 : undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          'fixed bg-surface-container-lowest shadow-ambient z-modal outline-none',
          'overflow-y-auto overscroll-contain',
          !dragOwned && 'transition-transform duration-300 ease-out motion-reduce:transition-none',
          container,
          !dragOwned && (open ? openClass : closed),
        )}
      >
        {title && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            className={cn(isSheet && 'touch-none select-none')}
          >
            {isSheet && <div className="mx-auto mt-2 h-1.5 w-9 rounded-full bg-outline-variant" aria-hidden />}
            <div className={cn('flex items-center justify-between gap-3 px-6', isSheet ? 'pb-2 pt-3' : 'border-b border-outline-variant/20 py-4')}>
              <h2 id={titleId} className="min-w-0 break-words text-headline text-surface-on">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close drawer"
                className="w-11 h-11 -m-1.5 flex shrink-0 items-center justify-center rounded-full text-surface-on-variant hover:bg-surface-container-low transition-colors"
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
        <div className={cn('p-6', isSheet && 'pt-2 pb-[max(env(safe-area-inset-bottom),1.5rem)]')}>{children}</div>
      </div>
    </>
  )
}
