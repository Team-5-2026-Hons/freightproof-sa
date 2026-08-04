'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { ChevronsRight } from 'lucide-react'
import { getTapToConfirmPref } from '@/lib/constants/preferences'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/Spinner'

// Replaces HoldButton's press-and-hold gesture with a slide-to-confirm track, the
// pattern drivers already know from ride-hailing and delivery apps. The safety property
// is unchanged and is the whole point of both designs: confirming a phase writes an
// immutable ledger row and can anchor to Hedera, so it must never be reachable by a
// single accidental tap. A hold and a swipe are two ways of demanding deliberate intent;
// the swipe just costs less patience at a loading bay in the rain.

// The thumb must cross this fraction of the track to count as a confirm. Deliberately
// short of 1.0: a driver in gloves or on a cracked screen should not have to land the
// final pixel. Below the threshold the thumb springs back and nothing fires.
const COMPLETE_THRESHOLD = 0.9

// Spring-back and snap-forward duration, and the confirmed flourish before onConfirm is
// called. One constant so the CSS transition and the dispatch delay cannot drift apart.
const SETTLE_DURATION_MS = 180

// How long the "swipe all the way across" hint stays up after a short swipe.
const HINT_DURATION_MS = 1500

// How long the tap-to-confirm fallback stays armed, so a stray first tap can't leave the
// control primed to fire on an unrelated later one.
const ARM_TIMEOUT_MS = 3000

// Track is h-14 (56px); the thumb insets by TRACK_PADDING_PX on every side.
const THUMB_SIZE_PX = 48
const TRACK_PADDING_PX = 4

// onConfirm may be fire-and-forget or async (submitAndAdvance uploads photos and calls the
// backend — seconds, not milliseconds). Narrower than `unknown` so a returned promise is
// detectable without an `any` cast at the call site.
function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<void>).then === 'function'
}

interface SwipeToConfirmProps {
  label: string
  onConfirm: () => void | Promise<void>
  disabled?: boolean
  variant?: 'primary' | 'danger'
}

export function SwipeToConfirm({
  label,
  onConfirm,
  disabled = false,
  variant = 'primary',
}: SwipeToConfirmProps) {
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isDispatching, setIsDispatching] = useState(false)
  // True while an async onConfirm is still pending — distinct from isDispatching (the
  // brief flourish before onConfirm is even called). Stops the driver staring at a dead
  // control through a multi-second upload, and stops a second submit.
  const [isBusy, setIsBusy] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [isArmed, setIsArmed] = useState(false)

  // Read the accessibility pref once on mount, matching the "applies next time" note in
  // settings. This matters MORE for a swipe than it did for a hold: dragging is a
  // fine-motor gesture, and a driver in thick gloves or with limited dexterity needs a
  // path that isn't a drag at all.
  const [tapToConfirm] = useState(() => getTapToConfirmPref())

  const trackRef = useRef<HTMLDivElement | null>(null)
  const maxTravelRef = useRef(0)
  const startXRef = useRef(0)
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Cancel pending timeouts so onConfirm/setState can never fire post-unmount — a
      // route change mid-gesture must not submit a phase.
      for (const ref of [settleTimeoutRef, hintTimeoutRef, armTimeoutRef]) {
        if (ref.current) {
          clearTimeout(ref.current)
          ref.current = null
        }
      }
    }
  }, [])

  // Returns the control to its resting state so the driver can swipe again. Only ever
  // called when an ASYNC onConfirm settles — see runConfirm.
  const rearm = useCallback(() => {
    setIsBusy(false)
    setIsDispatching(false)
    setOffset(0)
  }, [])

  const runConfirm = useCallback(() => {
    setShowHint(false)
    setIsDispatching(true)

    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current)
    // Let the thumb finish travelling before handing off, so the confirm reads as the
    // result of the gesture rather than interrupting it.
    settleTimeoutRef.current = setTimeout(() => {
      settleTimeoutRef.current = null
      if (!isMountedRef.current) return

      const result = onConfirm()
      if (isPromiseLike(result)) {
        setIsBusy(true)
        result.then(
          // Re-arming on success costs a brief flash of a live track before the caller's
          // navigation unmounts this component, and that is the right trade: the failure
          // path (submitAndAdvance catches its own errors, toasts, and leaves the driver
          // on this screen with their draft intact) resolves identically, and a control
          // that stayed dead there would strand them with no way to retry.
          () => {
            if (isMountedRef.current) rearm()
          },
          (err: unknown) => {
            if (isMountedRef.current) rearm()
            // Never swallow the rejection. submitAndAdvance handles its own errors and
            // does not reject by design, so reaching here means some other onConfirm
            // broke that contract — surface it rather than losing it.
            console.error('SwipeToConfirm: onConfirm rejected', err)
          },
        )
      }
      // Sync onConfirm: stay latched, deliberately. Every synchronous caller navigates
      // (router.push to the next step), and the component lives on until that route
      // change actually commits. Clearing isDispatching here — which is what this used to
      // do — handed the driver back a fully live track whose thumb was still parked at the
      // far end and whose label had faded to nothing: a blank strip they could, and did,
      // swipe a second time, firing a duplicate confirm into an in-flight navigation.
    }, SETTLE_DURATION_MS)
  }, [onConfirm, rearm])

  const isLocked = disabled || isDispatching || isBusy

  const releaseToStart = useCallback(() => {
    setOffset(0)
    setShowHint(true)
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current)
    hintTimeoutRef.current = setTimeout(() => {
      hintTimeoutRef.current = null
      if (!isMountedRef.current) return
      setShowHint(false)
    }, HINT_DURATION_MS)
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Re-entry guard. The `disabled` styling stops real pointers, but jsdom's
      // fireEvent and some assistive tech can still dispatch at a non-button element,
      // and a duplicate confirm here would mean a duplicate ledger write.
      if (isLocked) return

      const track = trackRef.current
      if (!track) return

      maxTravelRef.current = Math.max(track.offsetWidth - THUMB_SIZE_PX - TRACK_PADDING_PX * 2, 0)
      startXRef.current = e.clientX
      setIsDragging(true)
      setShowHint(false)
      // Capture so the gesture survives the pointer leaving the track — a driver's thumb
      // drifting off a 56px strip mid-swipe should not silently cancel the confirm.
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [isLocked],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || isLocked) return
      const dx = e.clientX - startXRef.current
      setOffset(Math.min(Math.max(dx, 0), maxTravelRef.current))
    },
    [isDragging, isLocked],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return
      setIsDragging(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }

      const max = maxTravelRef.current
      const progress = max > 0 ? offset / max : 0

      if (progress >= COMPLETE_THRESHOLD) {
        setOffset(max) // snap the last few pixels closed, then fire
        runConfirm()
        return
      }
      releaseToStart()
    },
    [isDragging, offset, runConfirm, releaseToStart],
  )

  const disarm = useCallback(() => {
    if (armTimeoutRef.current) {
      clearTimeout(armTimeoutRef.current)
      armTimeoutRef.current = null
    }
    setIsArmed(false)
  }, [])

  // Two-step confirm used by BOTH the tap-to-confirm preference and the keyboard path.
  // Keyboard users cannot perform a drag at all, so Enter/Space must reach the same
  // action — and it stays two-step so a single stray keypress still can't submit.
  const handleTwoStep = useCallback(() => {
    if (isLocked) return
    if (isArmed) {
      disarm()
      setOffset(maxTravelRef.current)
      runConfirm()
      return
    }
    setIsArmed(true)
    armTimeoutRef.current = setTimeout(() => {
      armTimeoutRef.current = null
      if (!isMountedRef.current) return
      setIsArmed(false)
    }, ARM_TIMEOUT_MS)
  }, [isLocked, isArmed, disarm, runConfirm])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault() // Space would otherwise scroll the step page underneath
      // Measure here too: a keyboard user may never have fired a pointer event, so
      // maxTravelRef would still be 0 and the thumb would not visibly travel.
      const track = trackRef.current
      if (track) {
        maxTravelRef.current = Math.max(track.offsetWidth - THUMB_SIZE_PX - TRACK_PADDING_PX * 2, 0)
      }
      handleTwoStep()
    },
    [handleTwoStep],
  )

  const max = maxTravelRef.current
  const progress = max > 0 ? offset / max : 0

  let currentLabel = label
  if (isBusy) currentLabel = 'Submitting…'
  else if (isDispatching) currentLabel = 'Confirmed'
  else if (isArmed) currentLabel = 'Press again to confirm'

  const hintVisible = showHint && !isDragging && !isDispatching && !isBusy

  // The label fades out as the thumb covers it, but ONLY while the driver is still
  // swiping. Once the confirm is dispatched the thumb is parked at the far end, so this
  // fraction is 0 — which rendered "Confirmed"/"Submitting…" completely invisible and
  // left an apparently empty track sitting there through the whole submit.
  const labelOpacity = isDispatching || isBusy ? 1 : 1 - progress

  // Tap-to-confirm renders a plain button, not a track: someone who enabled that pref
  // has told us a drag is the problem, so presenting a drag affordance at all is wrong.
  if (tapToConfirm) {
    return (
      <div className="relative flex w-full max-w-sm flex-col items-center">
        <button
          type="button"
          onClick={handleTwoStep}
          disabled={isLocked}
          className={cn(
            'flex h-14 w-full items-center justify-center gap-2 rounded-full px-6',
            // Same split as the track below: still click-blocked while working, but only
            // greyed out when the caller says the action isn't valid yet.
            'select-none transition-opacity',
            disabled && 'opacity-40',
            variant === 'primary' ? 'bg-primary' : 'bg-error',
          )}
        >
          {isBusy && <Spinner size="sm" className="border-white/30 border-t-white" />}
          <span className="text-sm font-bold uppercase tracking-wider text-white">
            {currentLabel}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="relative flex w-full max-w-sm flex-col items-center">
      <div
        ref={trackRef}
        // role="slider" is the honest ARIA mapping for a draggable track with a range,
        // and it gives assistive tech a value to announce as the thumb travels.
        role="slider"
        tabIndex={isLocked ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={currentLabel}
        aria-disabled={isLocked}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative h-14 w-full overflow-hidden rounded-full',
          // touch-none stops the browser claiming the horizontal drag for a scroll/swipe
          // gesture — without it the thumb stutters and the confirm becomes unreliable.
          'select-none touch-none outline-none',
          'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
          'transition-opacity',
          // Input-blocking and dimming are deliberately separate. A control that is
          // WORKING (dispatching/busy) must still be legible — dimming it to 40% while it
          // reads "Submitting…" hides the one piece of feedback the driver needs, on a
          // phone screen in daylight. Only the `disabled` prop, which means "not yet
          // valid to confirm", greys the track out.
          isLocked && 'pointer-events-none',
          disabled && 'opacity-40',
          variant === 'primary' ? 'bg-primary' : 'bg-error',
        )}
      >
        {/* Label sits under the thumb and fades as the thumb covers it, so the track
            never shows the thumb and its instruction fighting for the same space. */}
        <span
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center gap-2',
            'px-14 text-center text-sm font-bold uppercase tracking-wider text-white',
          )}
          style={{ opacity: labelOpacity }}
        >
          {isBusy && <Spinner size="sm" className="border-white/30 border-t-white" />}
          {currentLabel}
        </span>

        <div
          className={cn(
            'absolute top-1 flex items-center justify-center rounded-full bg-white shadow-ambient-header',
            // Follow the finger exactly while dragging; animate only when settling, so
            // the spring-back reads as physics rather than lag.
            !isDragging && 'transition-transform motion-reduce:transition-none',
          )}
          style={{
            left: TRACK_PADDING_PX,
            height: THUMB_SIZE_PX,
            width: THUMB_SIZE_PX,
            transform: `translateX(${offset}px)`,
            transitionDuration: isDragging ? undefined : `${SETTLE_DURATION_MS}ms`,
          }}
        >
          <ChevronsRight
            className={cn('h-5 w-5', variant === 'primary' ? 'text-primary' : 'text-error')}
            strokeWidth={2.5}
            aria-hidden
          />
        </div>
      </div>

      {/* Absolutely positioned so appearing/disappearing never nudges the track. */}
      {hintVisible && (
        <p role="status" className="absolute top-full mt-2 text-center text-xs text-surface-on-variant">
          Swipe all the way across to confirm
        </p>
      )}
    </div>
  )
}
