'use client'

// The back action the left-edge swipe performs, registered by the screen's own back control
// (SubpageHeader, StepHeader). One action, two inputs: the swipe can never go somewhere the
// chevron wouldn't, and a screen with no back control (a tab root, panic) gets no swipe.

import { useEffect, useRef, useSyncExternalStore } from 'react'

type BackHandler = () => void

let current: BackHandler | null = null
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((notify) => notify())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The registered back action, read when a swipe commits. */
export function getEdgeBackHandler(): BackHandler | null {
  return current
}

/** Whether the screen on display offers back — the swipe is armed only then. */
export function useHasEdgeBack(): boolean {
  return useSyncExternalStore(subscribe, () => current !== null, () => false)
}

/** Registers `handler` as the edge-swipe back action while the calling component is mounted. */
export function useEdgeBackHandler(handler: BackHandler): void {
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => {
    const registered: BackHandler = () => latest.current()
    current = registered
    emit()
    return () => {
      if (current === registered) {
        current = null
        emit()
      }
    }
  }, [])
}
