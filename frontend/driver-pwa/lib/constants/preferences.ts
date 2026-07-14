// Driver-local UI preferences persisted on-device only (localStorage).
// Not synced to the backend — these are accessibility/comfort settings.
export const PREF_TAP_TO_CONFIRM = 'fp:pref:tap-to-confirm'

export function getTapToConfirmPref(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PREF_TAP_TO_CONFIRM) === 'true'
  } catch {
    // Private browsing or storage disabled — fall back to the hold-to-confirm default
    // rather than throwing during render.
    console.warn('getTapToConfirmPref: failed to read preference from localStorage')
    return false
  }
}

export function setTapToConfirmPref(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREF_TAP_TO_CONFIRM, String(enabled))
  } catch {
    // Quota exceeded, private browsing, or storage disabled — the toggle still notifies
    // subscribers below so the UI reflects the choice for this session, even though it
    // won't survive a refresh.
    console.warn('setTapToConfirmPref: failed to persist preference to localStorage')
  }
  listeners.forEach((notify) => notify())
}

// Same-tab subscription channel for useSyncExternalStore consumers — the
// browser's native 'storage' event only fires in *other* tabs.
const listeners = new Set<() => void>()

export function subscribeTapToConfirmPref(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
