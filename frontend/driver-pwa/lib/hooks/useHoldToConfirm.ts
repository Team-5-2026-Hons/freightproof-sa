"use client"

import { useState, useRef, useCallback } from 'react'

export interface HoldToConfirmState {
  isPressing: boolean
  progress: number
  onPressStart: () => void
  onPressEnd: () => void
}

// Pure logic — no UI side effects. Safe to unit-test in isolation.
export function useHoldToConfirm(durationMs: number, onConfirm: () => void): HoldToConfirmState {
  const [isPressing, setIsPressing] = useState(false)
  const [progress, setProgress] = useState(0)
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const confirmedRef = useRef(false)

  const clear = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
    setIsPressing(false)
    setProgress(0)
    confirmedRef.current = false
  }, [])

  const onPressStart = useCallback(() => {
    confirmedRef.current = false
    setIsPressing(true)
    startTimeRef.current = Date.now()

    intervalRef.current = setInterval(() => {
      const p = Math.min((Date.now() - startTimeRef.current) / durationMs, 1)
      setProgress(p)
      if (p >= 1 && !confirmedRef.current) {
        confirmedRef.current = true
        clear()
        onConfirm()
      }
    }, 16)
  }, [durationMs, onConfirm, clear])

  const onPressEnd = useCallback(() => {
    if (!confirmedRef.current) clear()
  }, [clear])

  return { isPressing, progress, onPressStart, onPressEnd }
}
