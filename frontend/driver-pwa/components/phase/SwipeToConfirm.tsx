'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Check, ChevronsRight, Lock } from 'lucide-react'
import { getTapToConfirmPref } from '@/lib/constants/preferences'
import { playHaptic } from '@/lib/haptics'
import { SPRING_FLICK, SPRING_SETTLE, animateSpring, projectMomentum, rubberband, type SpringConfig } from '@/lib/motion/spring'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/Spinner'
import { useAccessibilityTextSize } from '@/lib/hooks/useAccessibilityTextSize'

const COMPLETE_THRESHOLD = 0.9

const FLICK_MIN_PROGRESS = 0.5

export const CONFIRM_DISPATCH_MS = 600

export const PANIC_DISPATCH_MS = 180

const HINT_DURATION_MS = 1500

const ARM_TIMEOUT_MS = 3000

const VELOCITY_WINDOW_MS = 100
const MIN_VELOCITY_SPAN_MS = 16

const THUMB_SIZE_REM = 3.5
const TRACK_PADDING_REM = 0.25
const FALLBACK_ROOT_FONT_PX = 16

/** The live px size of 1rem, so travel can be measured in the same unit the CSS uses. */
function rootFontPx(): number {
  if (typeof window === 'undefined') return FALLBACK_ROOT_FONT_PX
  const size = parseFloat(window.getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(size) && size > 0 ? size : FALLBACK_ROOT_FONT_PX
}

const RUBBERBAND_LIMIT_PX = 10

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<void>).then === 'function'
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

type SwipeVariant = 'primary' | 'danger'

interface SwipeVariantClasses {
  track: string
  committedTrack: string
  onTrack: string
  onCommitted: string
  spinner: string
  thumb: string
  glyph: string
}

const VARIANT_CLASSES: Record<SwipeVariant, SwipeVariantClasses> = {
  primary: {
    track:         'bg-primary',
    committedTrack:'bg-success',
    onTrack:       'text-primary-on',
    onCommitted:   'text-success-on',
    spinner:       'border-primary-on/30 border-t-primary-on',
    thumb:         'bg-primary-on',
    glyph:         'text-primary',
  },
  danger: {
    track:         'bg-error',
    committedTrack:'bg-error',
    onTrack:       'text-error-on',
    onCommitted:   'text-error-on',
    spinner:       'border-error-on/30 border-t-error-on',
    thumb:         'bg-error-on',
    glyph:         'text-error',
  },
}

const WAITING_CLASSES = {
  track: 'bg-fill',
  label: 'text-surface-on-variant',
  thumb: 'bg-surface-container-high',
  glyph: 'text-outline',
} as const

interface SwipeToConfirmProps {
  label: string
  waitingLabel?: string
  committedLabel?: string
  committedHint?: string
  /**
   * Told whenever a finger goes down on the track or lifts (or the system cancels the
   * touch) — the panic screen's red pulse runs exactly while the finger is down.
   */
  onPressChange?: (pressed: boolean) => void
  onConfirm: () => void | Promise<void>
  disabled?: boolean
  variant?: SwipeVariant
}

interface VelocitySample {
  x: number
  t: number
}

export function SwipeToConfirm({
  label,
  waitingLabel,
  committedLabel = 'Confirmed',
  committedHint,
  onPressChange,
  onConfirm,
  disabled = false,
  variant = 'primary',
}: SwipeToConfirmProps) {
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isCommitted, setIsCommitted] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [isArmed, setIsArmed] = useState(false)
  const variantClasses = VARIANT_CLASSES[variant]
  const dispatchMs = variant === 'danger' ? PANIC_DISPATCH_MS : CONFIRM_DISPATCH_MS

  const largeText = useAccessibilityTextSize()
  const [tapToConfirm] = useState(() => getTapToConfirmPref())

  const trackRef = useRef<HTMLDivElement | null>(null)
  const maxTravelRef = useRef(0)
  const startXRef = useRef(0)
  const offsetRef = useRef(0)
  const samplesRef = useRef<VelocitySample[]>([])
  const crossedThresholdRef = useRef(false)
  const cancelSpringRef = useRef<(() => void) | null>(null)
  const dispatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      cancelSpringRef.current?.()
      for (const ref of [dispatchTimeoutRef, hintTimeoutRef, armTimeoutRef]) {
        if (ref.current) {
          clearTimeout(ref.current)
          ref.current = null
        }
      }
    }
  }, [])

  const onPressChangeRef = useRef(onPressChange)
  onPressChangeRef.current = onPressChange
  useEffect(() => {
    onPressChangeRef.current?.(isDragging)
  }, [isDragging])

  const moveThumb = useCallback((value: number) => {
    offsetRef.current = value
    setOffset(value)
  }, [])

  const springTo = useCallback(
    (target: number, velocity: number, config: SpringConfig) => {
      cancelSpringRef.current?.()
      cancelSpringRef.current = null
      if (prefersReducedMotion()) {
        moveThumb(target)
        return
      }
      cancelSpringRef.current = animateSpring({
        from: offsetRef.current,
        to: target,
        velocity,
        config,
        onUpdate: (value) => {
          if (isMountedRef.current) moveThumb(value)
        },
        onComplete: () => {
          cancelSpringRef.current = null
        },
      })
    },
    [moveThumb],
  )

  const rearm = useCallback(() => {
    setIsBusy(false)
    setIsCommitted(false)
    crossedThresholdRef.current = false
    springTo(0, 0, SPRING_SETTLE)
  }, [springTo])

  const runConfirm = useCallback(
    (releaseVelocity: number) => {
      setShowHint(false)
      setIsCommitted(true)
      playHaptic(variant === 'danger' ? 'panic' : 'confirm')
      springTo(maxTravelRef.current, releaseVelocity, SPRING_SETTLE)

      if (dispatchTimeoutRef.current) clearTimeout(dispatchTimeoutRef.current)
      dispatchTimeoutRef.current = setTimeout(() => {
        dispatchTimeoutRef.current = null
        if (!isMountedRef.current) return

        const result = onConfirm()
        if (isPromiseLike(result)) {
          setIsBusy(true)
          result.then(
            () => {
              if (isMountedRef.current) rearm()
            },
            (err: unknown) => {
              if (isMountedRef.current) rearm()
              console.error('SwipeToConfirm: onConfirm rejected', err)
            },
          )
        }
      }, dispatchMs)
    },
    [onConfirm, rearm, springTo, variant, dispatchMs],
  )

  const isLocked = disabled || isCommitted || isBusy

  const releaseToStart = useCallback(
    (releaseVelocity: number) => {
      springTo(0, releaseVelocity, SPRING_FLICK)
      setShowHint(true)
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current)
      hintTimeoutRef.current = setTimeout(() => {
        hintTimeoutRef.current = null
        if (!isMountedRef.current) return
        setShowHint(false)
      }, HINT_DURATION_MS)
    },
    [springTo],
  )

  const measureTravel = useCallback(() => {
    const track = trackRef.current
    if (track) {
      const rem = rootFontPx()
      maxTravelRef.current = Math.max(track.offsetWidth - (THUMB_SIZE_REM + TRACK_PADDING_REM * 2) * rem, 0)
    }
  }, [])

  const recordSample = useCallback((x: number) => {
    const now = performance.now()
    samplesRef.current = [...samplesRef.current, { x, t: now }].filter((s) => now - s.t <= VELOCITY_WINDOW_MS)
  }, [])

  const releaseVelocity = useCallback((): number => {
    const samples = samplesRef.current
    if (samples.length < 2) return 0
    const first = samples[0]
    const last = samples[samples.length - 1]
    const span = last.t - first.t
    return span < MIN_VELOCITY_SPAN_MS ? 0 : ((last.x - first.x) / span) * 1000
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isLocked) return
      if (!trackRef.current) return

      measureTravel()
      cancelSpringRef.current?.()
      cancelSpringRef.current = null
      startXRef.current = e.clientX - offsetRef.current
      samplesRef.current = []
      recordSample(offsetRef.current)
      setIsDragging(true)
      setShowHint(false)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [isLocked, measureTravel, recordSample],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || isLocked) return
      const max = maxTravelRef.current
      const raw = e.clientX - startXRef.current
      const next = raw < 0
        ? -rubberband(-raw, RUBBERBAND_LIMIT_PX)
        : raw > max
          ? max + rubberband(raw - max, RUBBERBAND_LIMIT_PX)
          : raw
      moveThumb(next)
      recordSample(next)

      const reached = max > 0 && next / max >= COMPLETE_THRESHOLD
      if (reached && !crossedThresholdRef.current) playHaptic('threshold')
      crossedThresholdRef.current = reached
    },
    [isDragging, isLocked, moveThumb, recordSample],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return
      setIsDragging(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }

      const max = maxTravelRef.current
      const position = offsetRef.current
      const progress = max > 0 ? position / max : 0
      const velocity = releaseVelocity()
      const projected = position + projectMomentum(velocity)
      const isFlick = progress >= FLICK_MIN_PROGRESS && projected >= max

      if (progress >= COMPLETE_THRESHOLD || isFlick) {
        runConfirm(velocity)
        return
      }
      releaseToStart(velocity)
    },
    [isDragging, releaseVelocity, runConfirm, releaseToStart],
  )

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return
      setIsDragging(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      crossedThresholdRef.current = false
      springTo(0, 0, SPRING_SETTLE)
    },
    [isDragging, springTo],
  )

  const disarm = useCallback(() => {
    if (armTimeoutRef.current) {
      clearTimeout(armTimeoutRef.current)
      armTimeoutRef.current = null
    }
    setIsArmed(false)
  }, [])

  const handleTwoStep = useCallback(() => {
    if (isLocked) return
    if (isArmed) {
      disarm()
      runConfirm(0)
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
      e.preventDefault()
      measureTravel()
      handleTwoStep()
    },
    [handleTwoStep, measureTravel],
  )

  const max = maxTravelRef.current
  const progress = max > 0 ? Math.min(Math.max(offset / max, 0), 1) : 0

  let currentLabel = label
  if (isBusy) currentLabel = 'Submitting…'
  else if (isCommitted) currentLabel = committedLabel
  else if (isArmed) currentLabel = 'Press Again to Confirm'
  const visibleLabel = disabled && waitingLabel !== undefined ? waitingLabel : currentLabel

  const hintVisible = showHint && !isDragging && !isCommitted && !isBusy

  const labelOpacity = isCommitted || isBusy ? 1 : 1 - progress
  const trackClass = isCommitted
    ? variantClasses.committedTrack
    : disabled ? WAITING_CLASSES.track : variantClasses.track
  const labelClass = isCommitted
    ? variantClasses.onCommitted
    : disabled ? WAITING_CLASSES.label : variantClasses.onTrack
  const thumbClass = disabled ? WAITING_CLASSES.thumb : variantClasses.thumb
  const glyphClass = disabled ? WAITING_CLASSES.glyph : variantClasses.glyph

  if (tapToConfirm) {
    return (
      <div className="relative flex w-full max-w-sm flex-col items-center">
        <button
          type="button"
          onClick={handleTwoStep}
          disabled={isLocked}
          className={cn(
            'flex h-16 w-full items-center justify-center gap-2 rounded-full px-6',
            'select-none transition-[opacity,background-color] duration-300',
            trackClass,
          )}
        >
          {isBusy && <Spinner size="sm" className={variantClasses.spinner} />}
          {isCommitted && !isBusy && <Check className="h-5 w-5" strokeWidth={3} aria-hidden />}
          <span className={cn('text-headline', labelClass)}>{visibleLabel}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="relative flex w-full max-w-sm flex-col items-center">
      <div
        ref={trackRef}
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
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative h-16 w-full overflow-hidden rounded-full',
          'select-none touch-none outline-none',
          'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
          'transition-[opacity,background-color] duration-300',
          isLocked && 'pointer-events-none',
          trackClass,
        )}
      >
        <span
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center gap-2',
            largeText ? 'pl-[4.25rem] pr-3' : 'px-16',
            'text-center text-headline',
            labelClass,
          )}
          style={{ opacity: labelOpacity }}
        >
          {isBusy && <Spinner size="sm" className={variantClasses.spinner} />}
          {visibleLabel}
        </span>

        <div
          className={cn(
            'absolute top-1 flex items-center justify-center rounded-full shadow-ambient-header',
            thumbClass,
          )}
          style={{
            left: `${TRACK_PADDING_REM}rem`,
            height: `${THUMB_SIZE_REM}rem`,
            width: `${THUMB_SIZE_REM}rem`,
            transform: `translateX(${offset}px)`,
          }}
        >
          {isCommitted ? (
            <Check
              className={cn('h-6 w-6 animate-fade-in-scale motion-reduce:animate-none', variant === 'primary' ? 'text-success' : variantClasses.glyph)}
              strokeWidth={3}
              aria-hidden
            />
          ) : disabled ? (
            <Lock className={cn('h-5 w-5', glyphClass)} strokeWidth={2.2} aria-hidden />
          ) : (
            <ChevronsRight className={cn('h-5 w-5', glyphClass)} strokeWidth={2.5} aria-hidden />
          )}
        </div>
      </div>

      {isCommitted && committedHint !== undefined && (
        <p role="status" className="absolute top-full mt-1.5 text-center text-footnote leading-4 text-surface-on-variant">
          {committedHint}
        </p>
      )}
      {hintVisible && (
        <p role="status" className="absolute top-full mt-2 text-center text-footnote text-surface-on-variant">
          Swipe all the way across to confirm
        </p>
      )}
    </div>
  )
}
