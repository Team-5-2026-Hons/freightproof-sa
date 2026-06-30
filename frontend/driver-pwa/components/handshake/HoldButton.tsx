'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useHoldToConfirm } from '@/lib/hooks/useHoldToConfirm'
import { cn } from '@shared/lib/utils/cn'

// Flourish duration shared by the dispatch-delay timeout and the scale transition below —
// kept as a single constant so the two can never drift apart.
const FLOURISH_DURATION_MS = 180

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
  const reduceMotion = useReducedMotion()
  const flourishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Cancel any pending flourish timeout so onConfirm/setState never fire post-unmount.
      if (flourishTimeoutRef.current) {
        clearTimeout(flourishTimeoutRef.current)
        flourishTimeoutRef.current = null
      }
    }
  }, [])

  const handleConfirm = useCallback(() => {
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
    onPressStart()
  }, [isDispatching, onPressStart])

  const circumference = 2 * Math.PI * 26  // r=26
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <motion.button
      onPointerDown={handlePressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      disabled={disabled || isDispatching}
      animate={isDispatching ? { scale: [1, 1.15, 1] } : { scale: 1 }}
      transition={{ duration: FLOURISH_DURATION_MS / 1000, ease: 'easeOut' }}
      className={cn(
        'relative flex h-20 w-20 items-center justify-center rounded-full',
        'select-none touch-none transition-opacity disabled:opacity-40',
        variant === 'primary' ? 'bg-primary' : 'bg-error',
      )}
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" fill="none" stroke="white" strokeOpacity={0.2} strokeWidth="4" />
        {isPressing && (
          <circle
            cx="30" cy="30" r="26"
            fill="none" stroke="white" strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="relative z-10 text-center text-xs font-bold uppercase tracking-wider text-white leading-tight px-2">
        {isDispatching ? 'Confirmed' : isPressing ? 'Hold…' : label}
      </span>
    </motion.button>
  )
}
