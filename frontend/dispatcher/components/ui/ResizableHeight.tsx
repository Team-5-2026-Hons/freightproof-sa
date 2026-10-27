'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

export const RESIZE_KEY_STEP_PX = 40

/** The height after a drag of `delta` px (positive = pointer moved down), clamped to [min, max]. */
export function nextHeight(start: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, start + delta))
}

interface ResizableHeightProps {
  initialHeight: number
  minHeight: number
  maxHeight: number
  label: string
  className?: string
  children: ReactNode
}

/**
 * A block whose bottom edge can be dragged (or moved with the arrow keys) to change its
 * height. Children should fill it (`h-full`); anything that measures itself, such as a
 * Leaflet map, has to react to the size change on its own.
 */
export function ResizableHeight({ initialHeight, minHeight, maxHeight, label, className, children }: ResizableHeightProps) {
  const [height, setHeight] = useState(initialHeight)
  const stopDragRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopDragRef.current?.(), [])

  function startDrag(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height

    function onMove(move: globalThis.PointerEvent): void {
      setHeight(nextHeight(startHeight, move.clientY - startY, minHeight, maxHeight))
    }
    function stop(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      stopDragRef.current = null
    }
    stopDragRef.current?.()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    stopDragRef.current = stop
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.key === 'ArrowDown' ? RESIZE_KEY_STEP_PX : event.key === 'ArrowUp' ? -RESIZE_KEY_STEP_PX : 0
    if (step === 0) return
    event.preventDefault()
    setHeight(current => nextHeight(current, step, minHeight, maxHeight))
  }

  return (
    <div className={`relative ${className ?? ''}`} style={{ height }}>
      {children}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={label}
        aria-valuemin={minHeight}
        aria-valuemax={maxHeight}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={onKeyDown}
        className="group absolute inset-x-0 -bottom-3 z-[600] flex h-3 cursor-row-resize touch-none items-center justify-center focus-visible:outline-none"
      >
        <span className="h-1 w-10 rounded-full bg-outline-v transition-colors group-hover:bg-on-surf-v group-focus-visible:bg-sec" />
      </div>
    </div>
  )
}
