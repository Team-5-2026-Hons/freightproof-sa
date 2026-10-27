// Slide-to-confirm: confirming spends a single-use token and writes an immutable ledger
// row, so one accidental tap must never trigger it.
//
// A drag has to START on the thumb. A press anywhere on the track used to snap the thumb
// to the finger, so brushing the track while scrolling one-handed could complete the
// swipe; now the thumb follows the finger from wherever it was grabbed.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const COMPLETE_THRESHOLD = 0.9

const SETTLE_DURATION_MS = 180

const THUMB_SIZE_PX = 56
const TRACK_PADDING_PX = 4

const ASSISTIVE_BUTTON_LABEL = 'Confirm delivery without swiping'

interface SwipeProps {
  label: string
  disabled?: boolean
  busy?: boolean
  onConfirm: () => void | Promise<void>
}

export function Swipe({ label, disabled = false, busy = false, onConfirm }: SwipeProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isSettling, setIsSettling] = useState(false)
  const [trackWidth, setTrackWidth] = useState(0)

  const hasFiredRef = useRef(false)

  const activePointerRef = useRef<number | null>(null)
  const grabOffsetRef = useRef(0)

  const fireTimeoutRef = useRef<number | null>(null)

  const inert = disabled || busy

  useEffect(() => {
    const track = trackRef.current
    if (track === null) return
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

  useEffect(() => {
    if (!isSettling) return
    const id = window.setTimeout(() => setIsSettling(false), SETTLE_DURATION_MS)
    return () => window.clearTimeout(id)
  }, [isSettling])

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
      console.warn('[swipe] onConfirm rejected:', err)
    } finally {
      hasFiredRef.current = false
    }
  }, [onConfirm])

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
    if (inert || !e.isPrimary) return
    const track = trackRef.current
    if (track === null) return
    grabOffsetRef.current = e.clientX - e.currentTarget.getBoundingClientRect().left
    activePointerRef.current = e.pointerId
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

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => finishDrag(e, false),
    [finishDrag],
  )

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (inert) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (e.repeat) return
    fire()
  }, [inert, fire])

  const [prevDisabled, setPrevDisabled] = useState(disabled)
  if (disabled !== prevDisabled) {
    setPrevDisabled(disabled)
    if (disabled && offset !== 0) {
      setOffset(0)
      setIsSettling(true)
    }
  }

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
