'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
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

// A dismissal counts once the sheet would come to rest past half its own height — judged
// on where the flick is GOING (momentum projection), not where the finger lifted, so a
// short fast flick down dismisses and a slow drag that stops short springs back.
const DISMISS_FRACTION = 0.5
// How far the sheet may be pulled UP past its resting place: a little give, then it stops.
const OVERPULL_LIMIT_PX = 24
const VELOCITY_WINDOW_MS = 100
const MIN_VELOCITY_SPAN_MS = 16
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

interface DragSample {
  y: number
  t: number
}

// NOTE (deviation from @radix-ui/react-dialog): the drawer is kept mounted at
// all times and only translated off-canvas via CSS — its consumers (the Profile
// sheets, the sign-in number confirm) render it unconditionally and rely on that to
// avoid remounting its contents on every open/close. Radix's Dialog.Content, ported with
// `forceMount` to get the same "stays mounted while closed" contract, runs
// `hideOthers(content)` in a mount-only effect (empty dep array) inside
// DialogContentModal — meaning it would aria-hide the entire rest of the app
// the instant AppShell mounts, permanently, since the drawer never unmounts to
// trigger the cleanup. That's a correctness regression, not a style one, so
// this component stays hand-rolled.
//
// side="bottom" is an iOS sheet (audit H9): a grabber, drag-to-dismiss that follows the
// finger 1:1 and hands its velocity to a spring, a scrim that fades with the drag, and a
// close button kept as the way out for anyone who doesn't drag (HIG sheets: "Support
// swiping to dismiss", "Include a grabber").
export function Drawer({ open, onClose, side = 'right', children, title }: DrawerProps) {
  const titleId = useId()
  // The sheet's live drag offset in px while a gesture or its spring owns the position;
  // null hands the position back to the CSS open/closed classes.
  const [dragOffset, setDragOffset] = useState<number | null>(null)
  // Mirrors dragOffset synchronously, for the spring's starting point and a re-grab: both
  // must read the live on-screen value, not the last rendered one (emil-apple-design §3).
  const dragOffsetRef = useRef(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const startYRef = useRef(0)
  const samplesRef = useRef<DragSample[]>([])
  const isDraggingRef = useRef(false)
  const cancelSpringRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Locks the page behind the drawer while it's open — without this, the drawer sits
  // on top of a still-scrollable AppShell content region, so a swipe that lands
  // outside the panel scrolls the Home/Trips/Settings page underneath it instead of
  // (or as well as) the drawer, which reads as the whole screen being "unlocked".
  useEffect(() => {
    if (!open) return
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [open])

  useEffect(() => () => cancelSpringRef.current?.(), [])

  const isSheet = side === 'bottom'

  const settleTo = useCallback((target: number, velocity: number, dismiss: boolean) => {
    cancelSpringRef.current?.()
    const finish = () => {
      cancelSpringRef.current = null
      if (dismiss) onClose()
      // Hand back to the classes only once they agree with where the sheet now sits.
      setDragOffset(null)
    }
    if (prefersReducedMotion()) {
      finish()
      return
    }
    cancelSpringRef.current = animateSpring({
      from: dragOffsetRef.current,
      to: target,
      velocity,
      // A thrown sheet keeps a little of its throw; one let go of gently just settles.
      config: dismiss ? SPRING_SETTLE : SPRING_FLICK,
      onUpdate: (value) => {
        dragOffsetRef.current = value
        setDragOffset(value)
      },
      onComplete: finish,
    })
  }, [onClose])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isSheet || !open) return
    cancelSpringRef.current?.()
    cancelSpringRef.current = null
    isDraggingRef.current = true
    // Grab the sheet where it is — mid-spring included — keeping the finger's offset.
    if (dragOffset === null) dragOffsetRef.current = 0
    startYRef.current = e.clientY - dragOffsetRef.current
    samplesRef.current = [{ y: dragOffsetRef.current, t: performance.now() }]
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    const raw = e.clientY - startYRef.current
    // Down follows the finger exactly; up resists, because there is nothing above.
    const next = raw >= 0 ? raw : -rubberband(-raw, OVERPULL_LIMIT_PX)
    dragOffsetRef.current = next
    setDragOffset(next)
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

  // The system took the touch (Control Center, a notification, an incoming call): the
  // driver never let go on purpose, so whatever the drag looked like, the sheet stays.
  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    settleTo(0, 0, false)
  }

  const { container, open: openClass, closed } = panelClasses[side]
  const height = panelRef.current?.offsetHeight ?? 0
  // The scrim thins as the sheet is pulled down, so the page reappears in step with it.
  const scrimOpacity = dragOffset !== null && height > 0 ? Math.max(0, 1 - Math.max(dragOffset, 0) / height) : undefined

  return (
    <>
      {/* Always mounted, faded rather than removed, so closing fades the page back in
          instead of the dark layer vanishing in one frame. */}
      <div
        className={cn(
          'fixed inset-0 z-overlay bg-black/40 transition-opacity duration-300 motion-reduce:transition-none',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={scrimOpacity !== undefined ? { opacity: scrimOpacity, transition: 'none' } : undefined}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        // The panel stays mounted while closed (only translated off-canvas), so
        // without these attributes screen readers and find-in-page would surface
        // its contents on every screen. React 19 supports the `inert` boolean
        // prop natively; both attributes are omitted entirely while open.
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
        // A sheet is modal: tell assistive tech one has opened over the page, and name it
        // by its title. Closed, aria-hidden above already removes it from the tree.
        role="dialog"
        aria-modal={open ? true : undefined}
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          'fixed bg-surface-container-lowest shadow-ambient z-modal',
          'overflow-y-auto',
          // The drag (or its spring) owns the transform while it runs; the eased CSS
          // transition is only for programmatic open/close.
          dragOffset === null && 'transition-transform duration-300 ease-out motion-reduce:transition-none',
          container,
          dragOffset === null && (open ? openClass : closed),
        )}
        style={dragOffset !== null ? { transform: `translateY(${dragOffset}px)` } : undefined}
      >
        {title && (
          // On a sheet this whole strip — grabber and title row — is the drag handle.
          // touch-none stops the browser claiming the vertical drag as a page scroll.
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            className={cn(isSheet && 'touch-none select-none')}
          >
            {isSheet && <div className="mx-auto mt-2 h-1.5 w-9 rounded-full bg-outline-variant" aria-hidden />}
            <div className={cn('flex items-center justify-between gap-3 px-6', isSheet ? 'pb-2 pt-3' : 'border-b border-outline-variant/20 py-4')}>
              {/* min-w-0 + break-words: a long title at large text wraps, and the close
                  button keeps its place instead of being pushed off the sheet. */}
              <h2 id={titleId} className="min-w-0 break-words text-headline text-surface-on">{title}</h2>
              {/* w-11 (44px) meets the app's documented touch-target minimum (see
                  Button/IconButton/Switch) — the old w-8 (32px) was under it. -m-1.5
                  cancels the extra 12px so the layout box stays the 32px it always was:
                  header height and icon position are unchanged, only the tappable area
                  grows (the same pad-don't-grow pattern Switch documents). */}
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
