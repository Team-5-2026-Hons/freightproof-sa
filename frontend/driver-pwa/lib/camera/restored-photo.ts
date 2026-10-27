// A photo the native camera took while Android killed the WebView behind it.
//
// Android may destroy the app's WebView while the camera activity is in front, to reclaim
// memory. When the driver returns, Capacitor relaunches the app and hands the camera's
// result to the App plugin's `appRestoredResult` event instead of to the getPhoto() promise,
// which died with the old JavaScript. Without this, the photo the driver just took vanished:
// lib/navigation/resume.ts put them back on the step, but the tile was empty again.
//
// Two halves, joined by a key naming the capture control (screen + label):
//   - CameraCapture marks a capture as pending before it opens the camera, in localStorage,
//     because that is the only state that survives the WebView;
//   - CapacitorBridge receives the restored result and parks it here until the control
//     with the pending key mounts again and claims it through its own onCapture, so the
//     photo lands in the step's draft (usePhaseDraft) exactly like a normal capture.

const PENDING_CAPTURE_KEY = 'fp:pending-camera-capture'

export const PENDING_CAPTURE_MAX_AGE_MS = 30 * 60 * 1000

interface PendingCapture {
  key: string
  startedAt: string
}

let restored: { key: string, dataUrl: string } | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** The key that ties one capture control to its restored photo. */
export function captureKey(pathname: string, label: string): string {
  return `${pathname}#${label}`
}

/** Called just before the native camera opens. */
export function markCapturePending(key: string, now: Date = new Date()): void {
  const record: PendingCapture = { key, startedAt: now.toISOString() }
  try {
    storage()?.setItem(PENDING_CAPTURE_KEY, JSON.stringify(record))
  } catch (err) {
    console.warn('Could not mark the camera capture as pending', err)
  }
}

/** Called once the camera answered in this session, whatever it answered. */
export function clearCapturePending(): void {
  try {
    storage()?.removeItem(PENDING_CAPTURE_KEY)
  } catch (err) {
    console.warn('Could not clear the pending camera capture', err)
  }
}

function readPending(now: Date): PendingCapture | null {
  try {
    const raw = storage()?.getItem(PENDING_CAPTURE_KEY)
    if (raw == null) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { key, startedAt } = value as Record<string, unknown>
    if (typeof key !== 'string' || typeof startedAt !== 'string') return null
    const age = now.getTime() - Date.parse(startedAt)
    return Number.isFinite(age) && age >= 0 && age <= PENDING_CAPTURE_MAX_AGE_MS ? { key, startedAt } : null
  } catch {
    return null
  }
}

/** The data URL in a restored Camera.getPhoto result, if it carries one. */
export function photoDataUrlFrom(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const photo = data as Record<string, unknown>
  if (typeof photo.dataUrl === 'string' && photo.dataUrl.startsWith('data:image/')) return photo.dataUrl
  if (typeof photo.base64String === 'string' && typeof photo.format === 'string') {
    return `data:image/${photo.format};base64,${photo.base64String}`
  }
  return null
}

/**
 * Park a restored photo for the control that was waiting on it. Returns false when no
 * capture was pending (or it is too old to trust), so the photo is dropped rather than
 * attached to whatever screen happens to be open.
 */
export function receiveRestoredPhoto(dataUrl: string, now: Date = new Date()): boolean {
  const pending = readPending(now)
  clearCapturePending()
  if (pending === null) return false
  restored = { key: pending.key, dataUrl }
  listeners.forEach((notify) => notify())
  return true
}

/** Hand over the restored photo for `key`, once; null when there is none for it. */
export function claimRestoredPhoto(key: string): string | null {
  if (restored === null || restored.key !== key) return null
  const { dataUrl } = restored
  restored = null
  return dataUrl
}

/** Notified when a restored photo arrives, for a control already on screen. */
export function subscribeRestoredPhoto(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test-only: forget any parked photo. */
export function __resetRestoredPhotoForTests(): void {
  restored = null
  listeners.clear()
}
