// Haptic feedback for the moments that earn it. Deliberately a short, named list rather
// than a general "vibrate" helper: HIG playing-haptics asks for "a clear, causal
// relationship between each haptic and the action that causes it", so every call site
// says WHICH moment it is, and each moment maps to one fixed pattern.
//
// iOS has no web vibration API at all (navigator.vibrate is undefined in WKWebView), so
// the Capacitor plugin is the only way to reach the Taptic Engine. Every call is
// fire-and-forget: a haptic must never delay or block the action it accompanies.

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

export type HapticMoment =
  /** A swipe crosses the point where releasing will confirm. A light detent tick. */
  | 'threshold'
  /** A confirm swipe commits. The system "success" pattern. */
  | 'confirm'
  /** The panic swipe commits. Heavy, so it can never be mistaken for a routine confirm. */
  | 'panic'

let warned = false

// One warning per session, not one per swipe: on the web, or before `npx cap sync` has
// installed the native side of the plugin, every call rejects with "not implemented".
// That is expected and harmless, but should be visible once in the Safari/logcat console.
function warnOnce(err: unknown): void {
  if (warned) return
  warned = true
  console.warn('haptics: unavailable on this platform, continuing without them', err)
}

export function playHaptic(moment: HapticMoment): void {
  let pending: Promise<void>
  switch (moment) {
    case 'threshold':
      pending = Haptics.impact({ style: ImpactStyle.Light })
      break
    case 'confirm':
      pending = Haptics.notification({ type: NotificationType.Success })
      break
    case 'panic':
      pending = Haptics.impact({ style: ImpactStyle.Heavy })
      break
  }
  pending.catch(warnOnce)
}
