'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Check, ChevronsRight, Lock } from 'lucide-react'
import { getTapToConfirmPref } from '@/lib/constants/preferences'
import { playHaptic } from '@/lib/haptics'
import { SPRING_FLICK, SPRING_SETTLE, animateSpring, projectMomentum, rubberband, type SpringConfig } from '@/lib/motion/spring'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/Spinner'
import { useAccessibilityTextSize } from '@/lib/hooks/useAccessibilityTextSize'

// Confirming a phase writes an immutable ledger row and can anchor to Hedera, so it must
// never be reachable by a single accidental tap. Slide-to-confirm demands deliberate intent.
//
// This is also the app's one signature moment (design audit Q9): the same physical
// gesture closes every phase, so it is where the feel is spent — the thumb follows the
// finger 1:1, springs with the finger's own velocity, resists at the ends, ticks at the
// commit point, and lands as a ✓ on a filled track with a success haptic.

// The thumb must cross this fraction of the track to count as a confirm — short of 1.0
// so a driver in gloves doesn't have to land the final pixel.
const COMPLETE_THRESHOLD = 0.9

// A flick counts too, but only a deliberate one: the thumb must already be past halfway
// AND its momentum must project it past the end. A short, fast twitch near the start can
// never confirm.
const FLICK_MIN_PROGRESS = 0.5

// Delay between commit and handing off to onConfirm. Long enough for the thumb to spring
// home and the ✓ to register (the moment is the point), short enough not to feel like
// waiting. Exported so tests advance exactly this, never a copy of it.
export const CONFIRM_DISPATCH_MS = 600

// Panic does not wait for a flourish — the alert is the point.
export const PANIC_DISPATCH_MS = 180

// How long the "swipe all the way across" hint stays up after a short swipe.
const HINT_DURATION_MS = 1500

// How long the tap-to-confirm fallback stays armed, so a stray tap can't fire it later.
const ARM_TIMEOUT_MS = 3000

// Release velocity is measured over the last stretch of the drag only; older samples
// describe where the finger was, not where it was going.
const VELOCITY_WINDOW_MS = 100
// Below this span the samples are too close together to divide by honestly — treat the
// release as stationary rather than infinitely fast.
const MIN_VELOCITY_SPAN_MS = 16

// Track is h-16 (4rem); the thumb insets by TRACK_PADDING_REM on every side
// (3.5 + 0.25 + 0.25 = 4). All three in rem, never px: on an iPhone 1rem follows the
// driver's Text Size setting (globals.css), so a px thumb in a rem track sat off-centre
// the moment the root grew past 16px — 56px in a 68px track, 4px gap above, 8px below.
const THUMB_SIZE_REM = 3.5
const TRACK_PADDING_REM = 0.25
// jsdom and very old WebViews report no computed root size.
const FALLBACK_ROOT_FONT_PX = 16

/** The live px size of 1rem, so travel can be measured in the same unit the CSS uses. */
function rootFontPx(): number {
  if (typeof window === 'undefined') return FALLBACK_ROOT_FONT_PX
  const size = parseFloat(window.getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(size) && size > 0 ? size : FALLBACK_ROOT_FONT_PX
}

// How far the thumb may stretch past either end of its travel. rubberband() approaches its
// `dimension` argument asymptotically, so this is the hard ceiling on the give: enough to
// feel through the finger, never so much that the track's rounded end clips the thumb.
const RUBBERBAND_LIMIT_PX = 10

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

// onConfirm may be fire-and-forget or async. Narrower than `unknown` so a returned
// promise is detectable without an `any` cast.
function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<void>).then === 'function'
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

type SwipeVariant = 'primary' | 'danger'

interface SwipeVariantClasses {
  /** The track (or two-step button) fill. */
  track: string
  /** The track once the swipe has committed. */
  committedTrack: string
  /** The label, which has to read against that fill. */
  onTrack: string
  /** The label against the committed fill. */
  onCommitted: string
  /** The busy spinner, same requirement as the label. */
  spinner: string
  /** The dragged thumb — the fill's own "on" tone, so it reads as a cut-out of the track. */
  thumb: string
  /** The glyph inside the thumb. */
  glyph: string
}

// Paired tokens, never a literal white: `primary`/`error` invert between themes, so a
// hard-coded `text-white` would leave the label invisible on a light track in dark mode.
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
  // Only ever rendered on the panic screen. Since overhaul 7.1 that page is white (D5),
  // so the track is the app's red at full strength with a white thumb — the one red
  // control on the screen. The committed state stays red: "sent" is said by the screen
  // that follows, not by turning an emergency control green.
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

// The not-yet-ready look, shared by both variants (panic is never disabled in practice).
// Overhaul 4.3: a fill track with a grey, locked thumb — the control is clearly there,
// clearly not yet ready, and the label says why (waitingLabel).
const WAITING_CLASSES = {
  track: 'bg-fill',
  label: 'text-surface-on-variant',
  thumb: 'bg-surface-container-high',
  glyph: 'text-outline',
} as const

interface SwipeToConfirmProps {
  label: string
  /** Shown on the track while disabled — what the step still needs ("Add the sheet photo first"). */
  waitingLabel?: string
  /** The green end state, in the past tense ("Departed"). Defaults to Confirmed. */
  committedLabel?: string
  /** One line under the committed track on what happens next ("Opening In Transit…"). */
  committedHint?: string
  /**
   * Told whenever a finger goes down on the track or lifts (or the system cancels the
   * touch) — the panic screen's red pulse runs exactly while the finger is down (7.1b).
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
  // Committed: the gesture is done and the ✓ is showing, before onConfirm is even called.
  const [isCommitted, setIsCommitted] = useState(false)
  // True while an async onConfirm is still pending — distinct from isCommitted.
  const [isBusy, setIsBusy] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [isArmed, setIsArmed] = useState(false)
  const variantClasses = VARIANT_CLASSES[variant]
  const dispatchMs = variant === 'danger' ? PANIC_DISPATCH_MS : CONFIRM_DISPATCH_MS

  const largeText = useAccessibilityTextSize()
  // Read once on mount, matching the "applies next time" note in settings.
  const [tapToConfirm] = useState(() => getTapToConfirmPref())

  const trackRef = useRef<HTMLDivElement | null>(null)
  const maxTravelRef = useRef(0)
  const startXRef = useRef(0)
  // The thumb's live position. The spring writes it every frame; a new grab reads it, so
  // catching the thumb mid-spring picks it up exactly where it is (no jump).
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
      // Cancel pending timeouts so onConfirm/setState can never fire post-unmount.
      for (const ref of [dispatchTimeoutRef, hintTimeoutRef, armTimeoutRef]) {
        if (ref.current) {
          clearTimeout(ref.current)
          ref.current = null
        }
      }
    }
  }, [])

  // A ref, so a caller passing a fresh arrow each render doesn't re-fire the effect.
  const onPressChangeRef = useRef(onPressChange)
  onPressChangeRef.current = onPressChange
  // isDragging IS "a finger is on the track": set on pointer-down, cleared on release and
  // on a system cancel alike — so the report can never disagree with the gesture.
  useEffect(() => {
    onPressChangeRef.current?.(isDragging)
  }, [isDragging])

  const moveThumb = useCallback((value: number) => {
    offsetRef.current = value
    setOffset(value)
  }, [])

  // Springs the thumb to `target`, starting from wherever it is and as fast as it was
  // moving. Reduce Motion gets the end state directly — no travel at all.
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

  // Returns the control to resting state. Only called when an async onConfirm settles.
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
      // Same frame as the visual commit (emil-apple-design §13, harmony): the ✓ and the
      // haptic arrive together or the moment reads as two separate events.
      playHaptic(variant === 'danger' ? 'panic' : 'confirm')
      springTo(maxTravelRef.current, releaseVelocity, SPRING_SETTLE)

      if (dispatchTimeoutRef.current) clearTimeout(dispatchTimeoutRef.current)
      // Let the thumb land and the ✓ register before handing off, so the confirm reads as
      // the result of the gesture rather than being interrupted by a route change.
      dispatchTimeoutRef.current = setTimeout(() => {
        dispatchTimeoutRef.current = null
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
        // clearing the committed state here would hand back a live-looking track the
        // driver could swipe a second time, firing a duplicate confirm mid-navigation.
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

  // px/s over the recent window — what the finger was doing as it let go.
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
      // Re-entry guard: a duplicate confirm here would mean a duplicate ledger write.
      if (isLocked) return
      if (!trackRef.current) return

      measureTravel()
      // Catch the thumb where it is, even mid-spring, and keep the finger's offset from it.
      cancelSpringRef.current?.()
      cancelSpringRef.current = null
      startXRef.current = e.clientX - offsetRef.current
      samplesRef.current = []
      recordSample(offsetRef.current)
      setIsDragging(true)
      setShowHint(false)
      // Capture so the gesture survives the pointer leaving the track.
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [isLocked, measureTravel, recordSample],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || isLocked) return
      const max = maxTravelRef.current
      const raw = e.clientX - startXRef.current
      // 1:1 inside the track, rubber-banded past either end rather than hard-stopped.
      const next = raw < 0
        ? -rubberband(-raw, RUBBERBAND_LIMIT_PX)
        : raw > max
          ? max + rubberband(raw - max, RUBBERBAND_LIMIT_PX)
          : raw
      moveThumb(next)
      recordSample(next)

      // A light tick the moment releasing would confirm — the detent you can feel without
      // looking. Re-armed if the finger backs off, so it marks the edge both ways.
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

  // A cancel is the system taking the touch (Control Center, a notification banner, an
  // incoming call), never the driver letting go. Treating it as a release would let an OS
  // interruption at 90% write an immutable ledger row, so a cancel only ever goes home.
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

  // Shared by the tap-to-confirm preference and the keyboard path; stays two-step so a
  // single stray keypress still can't submit.
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
      e.preventDefault() // Space would otherwise scroll the step page underneath
      // Measure here too: a keyboard user may never have fired a pointer event.
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
  // Visible text only: the slider's accessible name stays the action, so a screen reader
  // still hears what the control does, then aria-disabled says it can't yet.
  const visibleLabel = disabled && waitingLabel !== undefined ? waitingLabel : currentLabel

  const hintVisible = showHint && !isDragging && !isCommitted && !isBusy

  // Full opacity once committed: with the thumb parked at the far end, progress-based
  // fading would otherwise render "Confirmed"/"Submitting…" invisible.
  const labelOpacity = isCommitted || isBusy ? 1 : 1 - progress
  // Disabled reads as "waiting", not "broken": a full-strength neutral track with a legible
  // label, instead of the whole control faded to 40% (2.6:1 — it looked switched off).
  // What it is waiting FOR is said by the step's checklist (StepLayout).
  const trackClass = isCommitted
    ? variantClasses.committedTrack
    : disabled ? WAITING_CLASSES.track : variantClasses.track
  const labelClass = isCommitted
    ? variantClasses.onCommitted
    : disabled ? WAITING_CLASSES.label : variantClasses.onTrack
  const thumbClass = disabled ? WAITING_CLASSES.thumb : variantClasses.thumb
  const glyphClass = disabled ? WAITING_CLASSES.glyph : variantClasses.glyph

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
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative h-16 w-full overflow-hidden rounded-full',
          // touch-none stops the browser claiming the drag for a scroll gesture.
          'select-none touch-none outline-none',
          'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
          'transition-[opacity,background-color] duration-300',
          // Input-blocking and the waiting look are deliberately separate: a working
          // control (committed/busy) must stay legible. Only `disabled` changes its look.
          isLocked && 'pointer-events-none',
          trackClass,
        )}
      >
        <span
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center gap-2',
            // Headline style (17pt semibold), Title Case from the caller — see Button for
            // why the uppercase voice went.
            // Symmetric clearance for the thumb normally; at accessibility text sizes the
            // thumb is big enough that symmetric padding left the label ~130px and three
            // lines, so it takes everything right of the thumb instead.
            largeText ? 'pl-[4.25rem] pr-3' : 'px-16',
            'text-center text-headline',
            labelClass,
          )}
          style={{ opacity: labelOpacity }}
        >
          {isBusy && <Spinner size="sm" className={variantClasses.spinner} />}
          {visibleLabel}
        </span>

        {/* No CSS transition on the thumb: the spring (or the finger) owns its position
            every frame, and a transition layered on top would lag both. */}
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

      {/* Absolutely positioned so appearing/disappearing never nudges the track. */}
      {isCommitted && committedHint !== undefined && (
        // mt-1.5: the line must fit inside the footer's 24px floor of bottom padding on a
        // phone with no home-indicator inset, or it is clipped at the screen edge.
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
