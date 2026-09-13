// frontend/receiver/components/Swipe.tsx
//
// Slide-to-confirm for the receiver's single act (FP-155).
//
// NOT a port of driver-pwa's SwipeToConfirm. That component is three hundred lines of
// design-system tokens, tap-to-confirm preferences, spinner variants and danger styling,
// all of it earned by being the control every phase in the driver app submits through.
// None of that applies here: this page has one button, seen once, by someone with no
// account and no preferences. Copying it would have dragged the whole driver design
// system into an app that deliberately does not have one.
//
// The safety property IS carried over, because it is the reason the pattern was chosen:
// confirming a delivery writes an immutable ledger row and spends a single-use token, so
// it must never be reachable by one accidental tap. A swipe demands deliberate intent.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Fraction of the track the thumb must cross to count. Short of 1.0 on purpose: a
// receiver in gloves, or on a cracked screen, should not have to land the final pixel.
const COMPLETE_THRESHOLD = 0.9

// Spring-back / snap-forward duration. One constant so the CSS transition and the
// dispatch delay cannot drift apart.
const SETTLE_DURATION_MS = 180

const THUMB_SIZE_PX = 56
const TRACK_PADDING_PX = 4

interface SwipeProps {
  label: string
  disabled?: boolean
  onConfirm: () => void | Promise<void>
}

export function Swipe({ label, disabled = false, onConfirm }: SwipeProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isSettling, setIsSettling] = useState(false)

  // Guards against a second dispatch from a keyboard activation landing on top of a
  // completed drag. The token is single-use and a double POST would burn the retry.
  const hasFiredRef = useRef(false)

  const maxOffset = useCallback(() => {
    const track = trackRef.current
    if (track === null) return 0
    return track.clientWidth - THUMB_SIZE_PX - TRACK_PADDING_PX * 2
  }, [])

  const fire = useCallback(async () => {
    if (hasFiredRef.current) return
    hasFiredRef.current = true
    await onConfirm()
  }, [onConfirm])

  const settleBack = useCallback(() => {
    setIsSettling(true)
    setOffset(0)
    window.setTimeout(() => setIsSettling(false), SETTLE_DURATION_MS)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
  }, [disabled])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || disabled) return
    const track = trackRef.current
    if (track === null) return
    const rect = track.getBoundingClientRect()
    const raw = e.clientX - rect.left - TRACK_PADDING_PX - THUMB_SIZE_PX / 2
    setOffset(Math.max(0, Math.min(raw, maxOffset())))
  }, [isDragging, disabled, maxOffset])

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)
    const limit = maxOffset()
    if (limit > 0 && offset / limit >= COMPLETE_THRESHOLD) {
      setIsSettling(true)
      setOffset(limit)
      window.setTimeout(() => { void fire() }, SETTLE_DURATION_MS)
      return
    }
    settleBack()
  }, [isDragging, offset, maxOffset, fire, settleBack])

  // Keyboard path. A swipe is unreachable without a pointer, and a receiver on a device
  // with assistive tech must still be able to confirm their own delivery — the whole
  // point of the feature is that this act belongs to them.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    void fire()
  }, [disabled, fire])

  useEffect(() => {
    // A disabled control must not stay parked at the far end of its track from a drag
    // that completed just before the identity fields were cleared.
    if (disabled) setOffset(0)
  }, [disabled])

  const progress = maxOffset() > 0 ? offset / maxOffset() : 0

  return (
    <div
      ref={trackRef}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`relative h-16 w-full touch-none select-none overflow-hidden rounded-full ${
        disabled ? 'bg-neutral-200' : 'bg-emerald-600'
      }`}
      style={{ padding: TRACK_PADDING_PX }}
    >
      <span
        className={`pointer-events-none absolute inset-0 flex items-center justify-center text-base font-medium ${
          disabled ? 'text-neutral-500' : 'text-white'
        }`}
        style={{ opacity: 1 - progress }}
      >
        {label}
      </span>
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow"
        style={{
          transform: `translateX(${offset}px)`,
          transition: isSettling ? `transform ${SETTLE_DURATION_MS}ms ease-out` : 'none',
        }}
        aria-hidden="true"
      >
        <span className="text-xl text-neutral-700">›</span>
      </div>
    </div>
  )
}
