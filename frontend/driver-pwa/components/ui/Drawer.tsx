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

// A dismissal counts once the sheet would come to rest past half its own height — judged
// on where the flick is GOING (momentum projection), not where the finger lifted, so a
// short fast flick down dismisses and a slow drag that stops short springs back.
const DISMISS_FRACTION = 0.5
// How far the sheet may be pulled UP past its resting place: a little give, then it stops.
const OVERPULL_LIMIT_PX = 24
const VELOCITY_WINDOW_MS = 100
const MIN_VELOCITY_SPAN_MS = 16
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

// Controls inside the drag strip own their own taps. Capturing the pointer for a drag on
// one of them re-targets the pointerup — and with it the click — to the strip, which is
// how the close button stopped working: every tap on the X became a zero-length drag.
const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [role="button"]'

// What Tab may land on inside an open sheet. The close button is always first.
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
// side="bottom" is an iOS sheet: a grabber, drag-to-dismiss that follows the
// finger 1:1 and hands its velocity to a spring, a scrim that fades with the drag, and a
// close button kept as the way out for anyone who doesn't drag (HIG sheets: "Support
// swiping to dismiss", "Include a grabber").
//
// The page behind an open sheet is kept still by the scrim itself (`touch-none`: a touch
// that starts on it can never become a scroll) and by `overscroll-contain` on the panel
// (scrolling the sheet's own content never chains to the page). Not by writing
// `overflow: hidden` onto <body>, which the previous version did: with `overflow-x:
// hidden` on <html> that style applied to the body box rather than the viewport, so it
// locked nothing — the trip page still scrolled under an open sheet — and a value left
// behind on <body> is exactly the kind of stale lock that breaks scrolling for good.
export function Drawer({ open, onClose, side = 'right', children, title }: DrawerProps) {
  const titleId = useId()
  // Whether a gesture or its spring owns the sheet's position; false hands it back to the
  // CSS open/closed classes. State only flips at the start and end of a drag: the offset
  // itself is written straight to the DOM (applyOffset), because rendering it re-rendered
  // the sheet and everything in it on every pointer move and every spring frame.
  const [dragOwned, setDragOwned] = useState(false)
  // The live drag offset in px, for the spring's starting point and a re-grab: both must
  // read the on-screen value, not the last rendered one.
  const dragOffsetRef = useRef(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scrimRef = useRef<HTMLDivElement | null>(null)
  const startYRef = useRef(0)
  const samplesRef = useRef<DragSample[]>([])
  const isDraggingRef = useRef(false)
  const cancelSpringRef = useRef<(() => void) | null>(null)
  // Where keyboard/VoiceOver focus was before the sheet opened, so closing hands it back
  // to the control that opened it instead of dropping it at the top of the page.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // aria-modal promises assistive tech that focus lives inside the dialog while it is
  // open. Keep the promise: move focus in on open (the close button, which is always
  // first), and give it back on close.
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

  // A finger moving on the panel scrolls the panel's own content when there is more of it
  // than fits, and otherwise nothing at all. Without this a short sheet is not a scroller,
  // so the browser hands the gesture to the page underneath (overscroll-behavior only
  // applies to elements that can actually scroll). Native listener, not React's onTouchMove:
  // React registers touchmove as passive, where preventDefault is ignored.
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

  // Hand the position back only once the classes are in the DOM, in the same frame:
  // clearing the inline transform any earlier showed the sheet at its open position for a
  // frame after a dismissing throw.
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

  // Moves the sheet and thins the scrim in step with it, without a render.
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
      // Hand back to the classes only once they agree with where the sheet now sits.
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
      // A thrown sheet keeps a little of its throw; one let go of gently just settles.
      config: dismiss ? SPRING_SETTLE : SPRING_FLICK,
      onUpdate: applyOffset,
      onComplete: finish,
    })
  }, [onClose, applyOffset])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isSheet || !open) return
    // A tap on the close button is the button's, never the start of a drag.
    if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR) !== null) return
    cancelSpringRef.current?.()
    cancelSpringRef.current = null
    isDraggingRef.current = true
    // Grab the sheet where it is — mid-spring included — keeping the finger's offset.
    if (!dragOwned) {
      // Pin the resting position inline before the classes let go of it, so nothing moves.
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
    // Down follows the finger exactly; up resists, because there is nothing above.
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

  // The system took the touch (Control Center, a notification, an incoming call): the
  // driver never let go on purpose, so whatever the drag looked like, the sheet stays.
  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    settleTo(0, 0, false)
  }

  // Tab cycles inside the sheet rather than escaping to the page behind it.
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
      {/* Always mounted, faded rather than removed, so closing fades the page back in
          instead of the dark layer vanishing in one frame. touch-none: a finger that lands
          on the scrim is dismissing or waiting, never scrolling the page underneath. */}
      <div
        ref={scrimRef}
        // The scrim thins as the sheet is pulled down (applyOffset), so the page reappears
        // in step with it.
        className={cn(
          'fixed inset-0 z-overlay touch-none bg-black/40 transition-opacity duration-300 motion-reduce:transition-none',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
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
        // Focusable itself, so a sheet with no controls can still hold focus.
        tabIndex={open ? -1 : undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          'fixed bg-surface-container-lowest shadow-ambient z-modal outline-none',
          'overflow-y-auto overscroll-contain',
          // The drag (or its spring) owns the transform while it runs; the eased CSS
          // transition is only for programmatic open/close.
          !dragOwned && 'transition-transform duration-300 ease-out motion-reduce:transition-none',
          container,
          !dragOwned && (open ? openClass : closed),
        )}
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
                  Button/Switch) — the old w-8 (32px) was under it. -m-1.5
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
