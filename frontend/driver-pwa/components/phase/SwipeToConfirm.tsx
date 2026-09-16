'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { ChevronsRight } from 'lucide-react'
import { getTapToConfirmPref } from '@/lib/constants/preferences'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/Spinner'

// Confirming a phase writes an immutable ledger row and can anchor to Hedera, so it must
// never be reachable by a single accidental tap. Slide-to-confirm demands deliberate intent.

// The thumb must cross this fraction of the track to count as a confirm — short of 1.0
// so a driver in gloves doesn't have to land the final pixel.
const COMPLETE_THRESHOLD = 0.9

// Spring-back/snap-forward duration and the confirmed flourish before onConfirm is
// called, in one constant so the CSS transition and dispatch delay can't drift apart.
const SETTLE_DURATION_MS = 180

// How long the "swipe all the way across" hint stays up after a short swipe.
const HINT_DURATION_MS = 1500

// How long the tap-to-confirm fallback stays armed, so a stray tap can't fire it later.
const ARM_TIMEOUT_MS = 3000

// Track is h-16 (64px); thumb insets by TRACK_PADDING_PX on every side (56 + 4 + 4 = 64).
// If the track height changes, THUMB_SIZE_PX must change with it to stay centred.
const THUMB_SIZE_PX = 56
const TRACK_PADDING_PX = 4

// onConfirm may be fire-and-forget or async. Narrower than `unknown` so a returned
// promise is detectable without an `any` cast.
function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<void>).then === 'function'
}

type SwipeVariant = 'primary' | 'danger'

interface SwipeVariantClasses {
  /** The track (or two-step button) fill. */
  track: string
  /** The label, which has to read against that fill. */
  onTrack: string
  /** The busy spinner, same requirement as the label. */
  spinner: string
  /** The dragged thumb — the fill's own "on" tone, so it reads as a cut-out of the track. */
  thumb: string
}

// Paired tokens, never a literal white: `primary`/`error` invert between themes, so a
// hard-coded `text-white` would leave the label invisible on a light track in dark mode.
const VARIANT_CLASSES: Record<SwipeVariant, SwipeVariantClasses> = {
  primary: {
    track:   'bg-primary',
    onTrack: 'text-primary-on',
    spinner: 'border-primary-on/30 border-t-primary-on',
    thumb:   'bg-primary-on',
  },
  danger: {
    track:   'bg-error',
    onTrack: 'text-error-on',
    spinner: 'border-error-on/30 border-t-error-on',
    thumb:   'bg-error-on',
  },
}

interface SwipeToConfirmProps {
  label: string
  onConfirm: () => void | Promise<void>
  disabled?: boolean
  variant?: SwipeVariant
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
  // brief flourish before onConfirm is even called).
  const [isBusy, setIsBusy] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [isArmed, setIsArmed] = useState(false)
  const variantClasses = VARIANT_CLASSES[variant]

  // Read once on mount, matching the "applies next time" note in settings.
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
      // Cancel pending timeouts so onConfirm/setState can never fire post-unmount.
      for (const ref of [settleTimeoutRef, hintTimeoutRef, armTimeoutRef]) {
        if (ref.current) {
          clearTimeout(ref.current)
          ref.current = null
        }
      }
    }
  }, [])

  // Returns the control to resting state. Only called when an async onConfirm settles.
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
          // navigation unmounts this component — the right trade, since the failure path
          // resolves identically and a dead control would strand the driver with no retry.
          () => {
            if (isMountedRef.current) rearm()
          },
          (err: unknown) => {
            if (isMountedRef.current) rearm()
            // submitAndAdvance does not reject by design; reaching here means some other
            // onConfirm broke that contract — surface it rather than losing it.
            console.error('SwipeToConfirm: onConfirm rejected', err)
          },
        )
      }
      // Sync onConfirm: stay latched deliberately. Every sync caller navigates, and
      // clearing isDispatching here would hand back a live-looking blank track the
      // driver could swipe a second time, firing a duplicate confirm mid-navigation.
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
      // Re-entry guard: a duplicate confirm here would mean a duplicate ledger write.
      if (isLocked) return

      const track = trackRef.current
      if (!track) return

      maxTravelRef.current = Math.max(track.offsetWidth - THUMB_SIZE_PX - TRACK_PADDING_PX * 2, 0)
      startXRef.current = e.clientX
      setIsDragging(true)
      setShowHint(false)
      // Capture so the gesture survives the pointer leaving the track.
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

  // Shared by the tap-to-confirm preference and the keyboard path; stays two-step so a
  // single stray keypress still can't submit.
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
      // Measure here too: a keyboard user may never have fired a pointer event.
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

  // Full opacity once dispatched: with the thumb parked at the far end, progress-based
  // fading would otherwise render "Confirmed"/"Submitting…" invisible.
  const labelOpacity = isDispatching || isBusy ? 1 : 1 - progress

  // Tap-to-confirm renders a plain button: a drag affordance is wrong once the driver
  // has told us a drag is the problem.
  if (tapToConfirm) {
    return (
      <div className="relative flex w-full max-w-sm flex-col items-center">
        <button
          type="button"
          onClick={handleTwoStep}
          disabled={isLocked}
          className={cn(
            'flex h-16 w-full items-center justify-center gap-2 rounded-full px-6',
            'select-none transition-opacity',
            disabled && 'opacity-40',
            variantClasses.track,
          )}
        >
          {isBusy && <Spinner size="sm" className={variantClasses.spinner} />}
          <span className={cn('text-base font-bold uppercase tracking-wider', variantClasses.onTrack)}>
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
        // Honest ARIA mapping for a draggable track with a range.
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
          'relative h-16 w-full overflow-hidden rounded-full',
          // touch-none stops the browser claiming the drag for a scroll gesture.
          'select-none touch-none outline-none',
          'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
          'transition-opacity',
          // Input-blocking and dimming are deliberately separate: a working control
          // (dispatching/busy) must stay legible. Only `disabled` greys the track out.
          isLocked && 'pointer-events-none',
          disabled && 'opacity-40',
          variantClasses.track,
        )}
      >
        <span
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center gap-2',
            'px-16 text-center text-base font-bold uppercase tracking-wider',
            variantClasses.onTrack,
          )}
          style={{ opacity: labelOpacity }}
        >
          {isBusy && <Spinner size="sm" className={variantClasses.spinner} />}
          {currentLabel}
        </span>

        <div
          className={cn(
            'absolute top-1 flex items-center justify-center rounded-full shadow-ambient-header',
            variantClasses.thumb,
            // Follow the finger exactly while dragging; animate only when settling.
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
