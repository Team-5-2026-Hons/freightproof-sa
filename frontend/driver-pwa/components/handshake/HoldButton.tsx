'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useHoldToConfirm } from '@/lib/hooks/useHoldToConfirm'
import { getTapToConfirmPref } from '@/lib/constants/preferences'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/Spinner'

// Flourish duration shared by the dispatch-delay timeout and the scale transition below —
// kept as a single constant so the two can never drift apart.
const FLOURISH_DURATION_MS = 180

// How long the "Keep holding…" early-release hint stays up before clearing itself.
const HINT_DURATION_MS = 1500

// How long a tap-to-confirm button stays armed before auto-disarming, so a stray first
// tap can't leave the button primed to fire on an unrelated later tap.
const ARM_TIMEOUT_MS = 3000

// Labels at or under this length fit the circle at text-xs; longer ones need text-[10px]
// to avoid clipping outside the ring (e.g. "SUBMIT (FLAG MISMATCH)").
const LONG_LABEL_CHARS = 12

// onConfirm may be a fire-and-forget handler or an async one (e.g. submitAndAdvance,
// which uploads photos and calls the backend — can take seconds). Narrower than
// `unknown` so we can detect a returned promise without an `any`/`unknown` cast at the
// call site.
function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<void>).then === 'function'
}

interface HoldButtonProps {
  label: string
  durationMs?: number
  onConfirm: () => void | Promise<void>
  disabled?: boolean
  variant?: 'primary' | 'danger'
}

export function HoldButton({
  label,
  durationMs = 2000,
  onConfirm,
  disabled = false,
  variant = 'primary',
}: HoldButtonProps) {
  const [isDispatching, setIsDispatching] = useState(false)
  // True while an async onConfirm's returned promise is still pending — distinct from
  // isDispatching (the brief flourish before onConfirm is even called). Keeps the driver
  // from seeing a dead button during a multi-second upload+submit and from retriggering it.
  const [isBusy, setIsBusy] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [isArmed, setIsArmed] = useState(false)
  // Read the accessibility pref once on mount — it only takes effect on the next
  // mounted confirm button, matching the "applies next time" note in settings.
  const [tapToConfirm] = useState(() => getTapToConfirmPref())
  const flourishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)
  // True between a hold's press-start and its completion. Lets press-end tell an early
  // release (still active → show hint) apart from a release after a completed hold.
  const pressActiveRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Cancel any pending timeouts so onConfirm/setState never fire post-unmount.
      if (flourishTimeoutRef.current) {
        clearTimeout(flourishTimeoutRef.current)
        flourishTimeoutRef.current = null
      }
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current)
        hintTimeoutRef.current = null
      }
      if (armTimeoutRef.current) {
        clearTimeout(armTimeoutRef.current)
        armTimeoutRef.current = null
      }
    }
  }, [])

  const handleConfirm = useCallback(() => {
    // A completed confirm is not an early release, and any lingering hint should clear.
    pressActiveRef.current = false
    setShowHint(false)
    setIsDispatching(true)
    // Defensive: clear any stale pending timeout before scheduling a new one.
    if (flourishTimeoutRef.current) {
      clearTimeout(flourishTimeoutRef.current)
    }
    // Let the flourish play before handing off — duration matches the scale transition below.
    flourishTimeoutRef.current = setTimeout(() => {
      flourishTimeoutRef.current = null
      if (!isMountedRef.current) return
      setIsDispatching(false)
      const result = onConfirm()
      if (isPromiseLike(result)) {
        setIsBusy(true)
        result.then(
          () => {
            if (isMountedRef.current) setIsBusy(false)
          },
          (err: unknown) => {
            if (isMountedRef.current) setIsBusy(false)
            // Never swallow the rejection silently. submitAndAdvance never rejects by
            // design (it handles its own errors internally), so this only fires if some
            // other onConfirm implementation breaks that contract — surface it for
            // debugging rather than losing it.
            console.error('HoldButton: onConfirm rejected', err)
          },
        )
      }
    }, FLOURISH_DURATION_MS)
  }, [onConfirm])

  const { isPressing, progress, onPressStart, onPressEnd } = useHoldToConfirm(
    durationMs,
    handleConfirm,
  )

  // Re-entry guard: while the flourish is pending or a prior submit is still in flight
  // (isBusy), ignore new press gestures so a second hold can't schedule a duplicate
  // onConfirm call — the `disabled` attribute covers real pointers, but this guard is
  // the one that actually stops it (jsdom's fireEvent, and some assistive tech, can
  // still dispatch events at a disabled element).
  const handlePressStart = useCallback(() => {
    if (isDispatching || isBusy) return
    pressActiveRef.current = true
    setShowHint(false) // a fresh press supersedes any visible hint
    onPressStart()
  }, [isDispatching, isBusy, onPressStart])

  const handlePressEnd = useCallback(() => {
    onPressEnd()
    // Press ended while still active (progress never reached 1) → early release.
    if (pressActiveRef.current) {
      pressActiveRef.current = false
      setShowHint(true)
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current)
      hintTimeoutRef.current = setTimeout(() => {
        hintTimeoutRef.current = null
        if (!isMountedRef.current) return
        setShowHint(false)
      }, HINT_DURATION_MS)
    }
  }, [onPressEnd])

  const disarm = useCallback(() => {
    if (armTimeoutRef.current) {
      clearTimeout(armTimeoutRef.current)
      armTimeoutRef.current = null
    }
    setIsArmed(false)
  }, [])

  // Two-tap accessibility path: first tap arms, second (while armed) confirms.
  const handleTap = useCallback(() => {
    if (isDispatching || isBusy) return
    if (isArmed) {
      disarm()
      handleConfirm()
      return
    }
    setIsArmed(true)
    armTimeoutRef.current = setTimeout(() => {
      armTimeoutRef.current = null
      if (!isMountedRef.current) return
      setIsArmed(false)
    }, ARM_TIMEOUT_MS)
  }, [isDispatching, isBusy, isArmed, disarm, handleConfirm])

  const circumference = 2 * Math.PI * 26 // r=26
  const strokeDashoffset = circumference * (1 - progress)

  // Draw the ring while holding, or fully drawn while armed in tap-to-confirm mode.
  const showRing = isPressing || (tapToConfirm && isArmed)
  const ringOffset = tapToConfirm && isArmed ? 0 : strokeDashoffset

  const hintVisible = showHint && !isPressing && !isDispatching

  let buttonLabel = label
  if (isBusy) buttonLabel = 'Submitting…'
  else if (isDispatching) buttonLabel = 'Confirmed'
  else if (tapToConfirm && isArmed) buttonLabel = 'Tap again to confirm'
  else if (isPressing) buttonLabel = 'Hold…'
  else if (hintVisible) buttonLabel = 'Keep holding…'

  // Size on the original label prop (not the transient text) so sizing stays stable.
  const labelSizeClass = label.length <= LONG_LABEL_CHARS ? 'text-xs' : 'text-[10px]'

  const pointerHandlers = tapToConfirm
    ? { onPointerDown: handleTap }
    : {
        onPointerDown: handlePressStart,
        onPointerUp: handlePressEnd,
        onPointerLeave: handlePressEnd,
      }

  return (
    // Relative wrapper reserves room for the helper line so the button never shifts.
    <div className="relative flex flex-col items-center">
      <button
        {...pointerHandlers}
        disabled={disabled || isDispatching || isBusy}
        className={cn(
          'relative flex h-24 w-24 items-center justify-center rounded-full',
          'select-none touch-none transition-opacity disabled:opacity-40',
          variant === 'primary' ? 'bg-primary' : 'bg-error',
          isDispatching && 'animate-confirm-pulse motion-reduce:animate-none',
        )}
      >
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="26" fill="none" stroke="white" strokeOpacity={0.2} strokeWidth="4" />
          {showRing && (
            <circle
              cx="30" cy="30" r="26"
              fill="none" stroke="white" strokeWidth="4"
              strokeDasharray={circumference}
              strokeDashoffset={ringOffset}
              strokeLinecap="round"
            />
          )}
        </svg>
        <span className="relative z-10 flex flex-col items-center gap-1.5 px-2">
          {isBusy && <Spinner size="sm" className="border-white/30 border-t-white" />}
          <span
            className={cn(
              'text-center font-bold uppercase tracking-wider text-white leading-tight',
              labelSizeClass,
            )}
          >
            {buttonLabel}
          </span>
        </span>
      </button>

      {/* Absolutely positioned so it never nudges the button when it appears/disappears. */}
      {hintVisible && (
        <p role="status" className="absolute top-full mt-2 text-center text-xs text-surface-on-variant">
          Press and hold to confirm
        </p>
      )}
    </div>
  )
}
