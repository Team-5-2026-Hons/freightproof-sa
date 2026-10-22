// Slide-to-confirm: confirming spends a single-use token and writes an immutable ledger
// row, so one accidental tap must never trigger it.
//
// A drag has to START on the thumb. A press anywhere on the track used to snap the thumb
// to the finger, so brushing the track while scrolling one-handed could complete the
// swipe; now the thumb follows the finger from wherever it was grabbed.
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

const ASSISTIVE_BUTTON_LABEL = 'Confirm delivery without swiping'

interface SwipeProps {
  label: string
  disabled?: boolean
  /**
   * The confirmation is in flight. The thumb stays parked at the far end, the label is
   * announced and input is ignored. The parent must hold this true while `onConfirm` works
   * and clear it if the attempt fails: that is what brings the thumb home and re-arms the swipe.
   */
  busy?: boolean
  onConfirm: () => void | Promise<void>
}

export function Swipe({ label, disabled = false, busy = false, onConfirm }: SwipeProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isSettling, setIsSettling] = useState(false)
  // The track's pixel width, mirrored into state rather than read from trackRef at render
  // time: a ref mutation triggers no re-render, so `progress` derived from a ref read
  // would go stale. Refreshed by a ResizeObserver instead.
  const [trackWidth, setTrackWidth] = useState(0)

  // At most one confirmation in flight: a double dispatch from a keyboard activation landing
  // on a completed drag would spend the single-use token twice. Released when onConfirm
  // settles, so a soft failure leaves the control usable for a retry.
  const hasFiredRef = useRef(false)

  // The pointer driving the current drag, and where on the thumb it grabbed it. Refs, not
  // state: they are read in event handlers and must not trigger renders.
  const activePointerRef = useRef<number | null>(null)
  const grabOffsetRef = useRef(0)

  // The delay between a completed drag and the dispatch. Tracked so an unmount inside that
  // window cannot confirm a delivery from a page the receiver has already left.
  const fireTimeoutRef = useRef<number | null>(null)

  // Input is ignored while the control is unavailable OR already working.
  const inert = disabled || busy

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

  useEffect(() => {
    return () => {
      if (fireTimeoutRef.current !== null) window.clearTimeout(fireTimeoutRef.current)
    }
  }, [])

  // Turns the transition off again once it has had time to play. Owned by an effect so the
  // timer is cleared on unmount without any bookkeeping.
  useEffect(() => {
    if (!isSettling) return
    const id = window.setTimeout(() => setIsSettling(false), SETTLE_DURATION_MS)
    return () => window.clearTimeout(id)
  }, [isSettling])

  // Re-arm: whatever blocked the control has cleared, so the next attempt must be allowed
  // even if the previous onConfirm never reported back.
  useEffect(() => {
    if (!disabled && !busy) hasFiredRef.current = false
  }, [disabled, busy])

  const maxOffset = useCallback((width: number) => {
    return width - THUMB_SIZE_PX - TRACK_PADDING_PX * 2
  }, [])

  const runConfirm = useCallback(async () => {
    try {
      await onConfirm()
    } catch (err: unknown) {
      // The parent owns the error UI. Logged rather than rethrown because the caller is a
      // timer or an event handler, where a rejection would surface only as an unhandled one.
      console.warn('[swipe] onConfirm rejected:', err)
    } finally {
      hasFiredRef.current = false
    }
  }, [onConfirm])

  // The keyboard and assistive-button entry point. The drag claims the same guard itself,
  // before its settle delay, so the two paths can't both dispatch.
  const fire = useCallback(() => {
    if (inert || hasFiredRef.current) return
    hasFiredRef.current = true
    void runConfirm()
  }, [inert, runConfirm])

  const settleBack = useCallback(() => {
    setIsSettling(true)
    setOffset(0)
  }, [])

  const handleThumbPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Primary pointer only: a second finger landing mid-drag must not hijack it.
    if (inert || !e.isPrimary) return
    const track = trackRef.current
    if (track === null) return
    // Remember where on the thumb the finger landed so the thumb never jumps to centre on it.
    grabOffsetRef.current = e.clientX - e.currentTarget.getBoundingClientRect().left
    activePointerRef.current = e.pointerId
    // Captured on the track, which owns the move/up/cancel handlers, so the drag keeps
    // reporting when the finger slides off the thumb.
    track.setPointerCapture(e.pointerId)
    setIsSettling(false)
    setIsDragging(true)
  }, [inert])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || inert || e.pointerId !== activePointerRef.current) return
    const track = trackRef.current
    if (track === null) return
    const rect = track.getBoundingClientRect()
    const raw = e.clientX - grabOffsetRef.current - rect.left - TRACK_PADDING_PX
    setOffset(Math.max(0, Math.min(raw, maxOffset(trackWidth))))
  }, [isDragging, inert, maxOffset, trackWidth])

  const finishDrag = useCallback((e: React.PointerEvent<HTMLDivElement>, mayComplete: boolean) => {
    if (e.pointerId !== activePointerRef.current) return
    activePointerRef.current = null
    setIsDragging(false)
    const limit = maxOffset(trackWidth)
    if (
      mayComplete &&
      !inert &&
      !hasFiredRef.current &&
      limit > 0 &&
      offset / limit >= COMPLETE_THRESHOLD
    ) {
      // Claimed now, not when the timer runs, so an Enter or button press inside the settle
      // window is refused instead of racing the drag.
      hasFiredRef.current = true
      setIsSettling(true)
      setOffset(limit)
      fireTimeoutRef.current = window.setTimeout(() => {
        fireTimeoutRef.current = null
        void runConfirm()
      }, SETTLE_DURATION_MS)
      return
    }
    settleBack()
  }, [maxOffset, trackWidth, inert, offset, runConfirm, settleBack])

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => finishDrag(e, true),
    [finishDrag],
  )

  // A cancelled gesture (the OS took the touch for a system swipe, a call came in) is not
  // the receiver's decision, however far the thumb had travelled. It can only go back.
  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => finishDrag(e, false),
    [finishDrag],
  )

  // Keyboard path: a swipe is unreachable without a pointer, and assistive-tech users
  // must still be able to confirm their own delivery.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (inert) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    // A held key repeats; with the guard released after each attempt, repeats would retry.
    if (e.repeat) return
    fire()
  }, [inert, fire])

  // A disabled control must not stay parked at the end of its track. Applies to `disabled`
  // only: while `busy` the parked thumb is the point.
  const [prevDisabled, setPrevDisabled] = useState(disabled)
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled)
    if (disabled && offset !== 0) {
      setOffset(0)
      setIsSettling(true)
    }
  }

  // The attempt ended and the control is usable again: bring the thumb home so the retry
  // starts from the beginning rather than from a full track.
  const [prevBusy, setPrevBusy] = useState(busy)
  if (busy !== prevBusy) {
    setPrevBusy(busy)
    if (!busy) {
      setOffset(0)
      setIsSettling(true)
    }
  }

  const limit = maxOffset(trackWidth)
  const thumbOffset = busy ? Math.max(0, limit) : offset
  const progress = limit > 0 ? thumbOffset / limit : 0

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={trackRef}
        role="button"
        tabIndex={inert ? -1 : 0}
        aria-label={label}
        aria-disabled={inert}
        aria-busy={busy}
        onKeyDown={handleKeyDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className={`relative h-16 w-full touch-none select-none overflow-hidden rounded-full ${
          disabled ? 'bg-neutral-200' : 'bg-emerald-700'
        }`}
        style={{ padding: TRACK_PADDING_PX }}
      >
        {/* Always a live region so "Confirming…" is announced when the label changes; it
            stays fully visible while busy because the parked thumb would otherwise fade it out. */}
        <span
          aria-live="polite"
          className={`pointer-events-none absolute inset-0 flex items-center justify-center text-base font-medium ${
            disabled ? 'text-neutral-600' : 'text-white'
          }`}
          style={{ opacity: busy ? 1 : 1 - progress }}
        >
          {label}
        </span>
        <div
          data-testid="swipe-thumb"
          onPointerDown={handleThumbPointerDown}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow"
          style={{
            transform: `translateX(${thumbOffset}px)`,
            transition: isSettling ? `transform ${SETTLE_DURATION_MS}ms ease-out` : 'none',
          }}
          aria-hidden="true"
        >
          <span className="text-xl text-neutral-700">›</span>
        </div>
      </div>

      {/* Hidden until focused: a screen-reader user cannot perform a drag, and a bare
          role="button" with no click handler does nothing for a double-tap. This is the
          same guarded fire(), never a second route to the API. */}
      <button
        type="button"
        aria-disabled={inert}
        onClick={fire}
        className="sr-only focus:not-sr-only focus:rounded-lg focus:border focus:border-emerald-700 focus:bg-white focus:px-4 focus:py-3 focus:text-center focus:text-base focus:font-medium focus:text-emerald-800 aria-disabled:opacity-60"
      >
        {ASSISTIVE_BUTTON_LABEL}
      </button>
    </div>
  )
}
