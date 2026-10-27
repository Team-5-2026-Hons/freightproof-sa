'use client'

import { useCallback, useSyncExternalStore } from 'react'

const KEY_PREFIX = 'fp:driver-photo:'

const listeners = new Set<() => void>()

function keyFor(driverId: string): string {
  return `${KEY_PREFIX}${driverId}`
}

function notify(): void {
  listeners.forEach((listener) => listener())
}

export function getDriverPhoto(driverId: string): string | null {
  try {
    return window.localStorage.getItem(keyFor(driverId))
  } catch (err) {
    console.warn('driver-photo: could not read the stored photo', err)
    return null
  }
}

/** Returns false when the phone refused to store it (storage full or blocked). */
export function setDriverPhoto(driverId: string, dataUrl: string): boolean {
  try {
    window.localStorage.setItem(keyFor(driverId), dataUrl)
    notify()
    return true
  } catch (err) {
    console.warn('driver-photo: could not store the photo', err)
    return false
  }
}

export function clearDriverPhoto(driverId: string): void {
  try {
    window.localStorage.removeItem(keyFor(driverId))
  } catch (err) {
    console.warn('driver-photo: could not remove the stored photo', err)
  }
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(KEY_PREFIX)) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The signed-in driver's photo as a data URL, or null when none has been taken. */
export function useDriverPhoto(driverId: string | null): string | null {
  const getSnapshot = useCallback(() => (driverId === null ? null : getDriverPhoto(driverId)), [driverId])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
