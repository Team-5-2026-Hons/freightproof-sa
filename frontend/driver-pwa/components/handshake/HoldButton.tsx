'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useHoldToConfirm } from '@/lib/hooks/useHoldToConfirm'
import { getTapToConfirmPref } from '@/lib/constants/preferences'
import { cn } from '@shared/lib/utils/cn'

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

interface HoldButtonProps {
  label: string
  durationMs?: number
  onConfirm: () => void
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
  const [showHint, setShowHint] = useState(false)
  const [isArmed, setIsArmed] = useState(false)
  // Read the accessibility pref once on mount — it only takes effect on the next
  // mounted confirm button, matching the "applies next time" note in settings.
  const [tapToConfirm] = useState(() => getTapToConfirmPref())
  const reduceMotion = useReducedMotion()
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
      onConfirm()
    }, reduceMotion ? 0 : FLOURISH_DURATION_MS)
  }, [onConfirm, reduceMotion])

  const { isPressing, progress, onPressStart, onPressEnd } = useHoldToConfirm(
    durationMs,
    handleConfirm,
  )

  // Re-entry guard: while the flourish is pending, ignore new press gestures so a second
  // hold can't complete and schedule a second timeout (which would double-fire onConfirm).
  const handlePressStart = useCallback(() => {
    if (isDispatching) return
    pressActiveRef.current = true
    setShowHint(false) // a fresh press supersedes any visible hint
    onPressStart()
  }, [isDispatching, onPressStart])

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
    if (isDispatching) return
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
  }, [isDispatching, isArmed, disarm, handleConfirm])

  const circumference = 2 * Math.PI * 26 // r=26
  const strokeDashoffset = circumference * (1 - progress)

  // Draw the ring while holding, or fully drawn while armed in tap-to-confirm mode.
  const showRing = isPressing || (tapToConfirm && isArmed)
  const ringOffset = tapToConfirm && isArmed ? 0 : strokeDashoffset

  const hintVisible = showHint && !isPressing && !isDispatching

  let buttonLabel = label
  if (isDispatching) buttonLabel = 'Confirmed'
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
      <motion.button
        {...pointerHandlers}
        disabled={disabled || isDispatching}
        animate={isDispatching ? { scale: [1, 1.15, 1] } : { scale: 1 }}
        transition={{ duration: FLOURISH_DURATION_MS / 1000, ease: 'easeOut' }}
        className={cn(
          'relative flex h-24 w-24 items-center justify-center rounded-full',
          'select-none touch-none transition-opacity disabled:opacity-40',
          variant === 'primary' ? 'bg-primary' : 'bg-error',
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
        <span className={cn('relative z-10 text-center font-bold uppercase tracking-wider text-white leading-tight px-2', labelSizeClass)}>
          {buttonLabel}
        </span>
      </motion.button>

      {/* Absolutely positioned so it never nudges the button when it appears/disappears. */}
      {hintVisible && (
        <p role="status" className="absolute top-full mt-2 text-center text-xs text-surface-on-variant">
          Press and hold to confirm
        </p>
      )}
    </div>
  )
}
