'use client'

// iOS's swipe-from-the-left-edge to go back, for a web view that has none of its own.
//
// Capacitor's WKWebView has no navigation controller, so the system gesture doesn't exist;
// the native back-forward gesture would replay raw browser history, which in this app is
// full of screens a driver must not return to (see lib/navigation/back-stack). This performs
// the screen's own registered back action (lib/navigation/edge-back) instead.
//
// Feel: the screen follows the finger 1:1 from where it was grabbed
// (§2), commits on where the gesture is GOING, not where it stopped (§6, projection), carries
// the finger's speed into the spring (§5), and a system cancel never commits (§10).

import { useCallback, useEffect, useRef, useState } from 'react'
import { SPRING_SETTLE, animateSpring, projectMomentum } from '@/lib/motion/spring'
import { getEdgeBackHandler, useHasEdgeBack } from '@/lib/navigation/edge-back'

// Only a touch that starts this close to the left edge is a back swipe. Clear of the round
// back button, which starts 16px in, so a tap on the button is never taken as a swipe.
const EDGE_ZONE_PX = 16
// Movement before the gesture picks a direction: a
// vertical scroll that starts at the edge must stay a scroll.
const INTENT_PX = 10
// Released past this share of the screen width (after projection), the swipe goes back.
const COMMIT_FRACTION = 0.5
// Velocity is read over the tail of the gesture only — where the finger was going.
const VELOCITY_WINDOW_MS = 100
const MIN_VELOCITY_SPAN_MS = 16
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
// Anything inside an open dialog belongs to the dialog, never to the screen behind it.
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]'

interface Sample {
  x: number
  t: number
}

interface Gesture {
  pointerId: number
  startX: number
  startY: number
  tracking: boolean
  samples: Sample[]
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export interface EdgeSwipeBack {
  /** Whether the screen has a back action at all — the swipe is armed only then. */
  armed: boolean
  /** The screen's live offset in px while a swipe (or its spring) owns it; null at rest. */
  offset: number | null
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void
  }
}

export function useEdgeSwipeBack(): EdgeSwipeBack {
  const armed = useHasEdgeBack()
  const [offset, setOffset] = useState<number | null>(null)
  const offsetRef = useRef(0)
  const gestureRef = useRef<Gesture | null>(null)
  const cancelSpringRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cancelSpringRef.current?.(), [])

  const move = useCallback((value: number) => {
    offsetRef.current = value
    setOffset(value)
  }, [])

  const settle = useCallback((target: number, velocity: number, onDone: () => void) => {
    cancelSpringRef.current?.()
    if (prefersReducedMotion()) {
      cancelSpringRef.current = null
      onDone()
      return
    }
    cancelSpringRef.current = animateSpring({
      from: offsetRef.current,
      to: target,
      velocity,
      config: SPRING_SETTLE,
      onUpdate: move,
      onComplete: () => {
        cancelSpringRef.current = null
        onDone()
      },
    })
  }, [move])

  const springHome = useCallback((velocity: number) => {
    settle(0, velocity, () => setOffset(null))
  }, [settle])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!armed || e.clientX > EDGE_ZONE_PX) return
    if (e.target instanceof Element && e.target.closest(DIALOG_SELECTOR)) return
    // Catch a screen that is still springing home, from where it is.
    cancelSpringRef.current?.()
    cancelSpringRef.current = null
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX - offsetRef.current,
      startY: e.clientY,
      tracking: false,
      samples: [],
    }
  }, [armed])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (gesture === null || e.pointerId !== gesture.pointerId) return
    const dx = e.clientX - gesture.startX
    const dy = e.clientY - gesture.startY

    if (!gesture.tracking) {
      if (Math.abs(dy) > INTENT_PX && Math.abs(dy) > Math.abs(dx)) {
        gestureRef.current = null // a scroll that started at the edge
        return
      }
      if (dx <= INTENT_PX || dx <= Math.abs(dy)) return
      gesture.tracking = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }

    // Nothing sits to the left of the first screen, so the screen never moves past its edge.
    const next = Math.max(0, dx)
    move(next)
    const now = performance.now()
    gesture.samples = [...gesture.samples, { x: next, t: now }].filter((s) => now - s.t <= VELOCITY_WINDOW_MS)
  }, [move])

  const release = useCallback((e: React.PointerEvent<HTMLElement>, canCommit: boolean) => {
    const gesture = gestureRef.current
    gestureRef.current = null
    if (gesture === null || !gesture.tracking) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)

    const { samples } = gesture
    const span = samples.length < 2 ? 0 : samples[samples.length - 1].t - samples[0].t
    const velocity = span < MIN_VELOCITY_SPAN_MS ? 0 : ((samples[samples.length - 1].x - samples[0].x) / span) * 1000

    const width = e.currentTarget.offsetWidth
    const projected = offsetRef.current + projectMomentum(velocity)
    const handler = getEdgeBackHandler()

    if (canCommit && handler !== null && width > 0 && projected > width * COMMIT_FRACTION) {
      // Off the trailing edge first, then navigate: the screen leaves the way the finger
      // sent it, and the previous one returns from the leading edge (template's pop-in).
      settle(width, velocity, handler)
      return
    }
    springHome(velocity)
  }, [settle, springHome])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => release(e, true), [release])
  // The system took the touch: the driver never let go on purpose, so it never commits.
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLElement>) => release(e, false), [release])

  return { armed, offset, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } }
}
