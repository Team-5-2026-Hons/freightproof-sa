// Slide-to-confirm for the receiver's single act. NOT a port of driver-pwa's
// SwipeToConfirm — that component's design-system tokens and preferences don't apply to
// a one-button page seen once by someone with no account. The safety property IS carried
// over: confirming spends a single-use token and writes an immutable ledger row, so it
// must never be reachable by one accidental tap.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Fraction of the track the thumb must cross to count — short of 1.0 so a receiver in
// gloves or on a cracked screen needn't land the final pixel.
const COMPLETE_THRESHOLD = 0.9

// Spring-back / snap-forward duration, one constant so the CSS transition and the
// dispatch delay can't drift apart.
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
  // The track's pixel width, mirrored into state rather than read from trackRef at render
  // time: a ref mutation triggers no re-render, so `progress` derived from a ref read
  // would go stale. Refreshed by a ResizeObserver instead.
  const [trackWidth, setTrackWidth] = useState(0)

  // Guards against a second dispatch from a keyboard activation landing on a completed
  // drag — the token is single-use and a double POST would burn the retry.
  const hasFiredRef = useRef(false)

  useEffect(() => {
    const track = trackRef.current
    if (track === null) return
    // observe() fires the callback once immediately, so this also serves as the initial measurement.
    const observer = new ResizeObserver(() => {
      setTrackWidth(track.clientWidth)
    })
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const maxOffset = useCallback((width: number) => {
    return width - THUMB_SIZE_PX - TRACK_PADDING_PX * 2
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
    setOffset(Math.max(0, Math.min(raw, maxOffset(trackWidth))))
  }, [isDragging, disabled, maxOffset, trackWidth])

  const handlePointerUp = useCallback(() => {
    if (!isDragging) return
    setIsDragging(false)
    const limit = maxOffset(trackWidth)
    if (limit > 0 && offset / limit >= COMPLETE_THRESHOLD) {
      setIsSettling(true)
      setOffset(limit)
      window.setTimeout(() => { void fire() }, SETTLE_DURATION_MS)
      return
    }
    settleBack()
  }, [isDragging, offset, maxOffset, trackWidth, fire, settleBack])

  // Keyboard path: a swipe is unreachable without a pointer, and assistive-tech users
  // must still be able to confirm their own delivery.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    void fire()
  }, [disabled, fire])

  // A disabled control must not stay parked at the far end of its track. Written during
  // render, not an effect — the standard "adjusting state when a prop changes" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect).
  const [prevDisabled, setPrevDisabled] = useState(disabled)
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled)
    if (disabled && offset !== 0) setOffset(0)
  }

  const limit = maxOffset(trackWidth)
  const progress = limit > 0 ? offset / limit : 0

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
