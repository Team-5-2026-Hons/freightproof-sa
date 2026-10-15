// Keeps the iOS/Android status-bar text readable against whatever the app is painting.
//
// The native default follows the PHONE's appearance, but the app has its own theme setting
// (lib/theme.ts) and the sign-in flow is always dark (components/auth/AuthFrame.tsx). A
// phone in light mode running the app dark would otherwise draw black clock and battery
// glyphs on a near-black screen.
//
// Two inputs, one output: the resolved app theme, and an optional screen-level override
// that wins while it is set. Every call is fire-and-forget, and a no-op on the web.

import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import type { ResolvedTheme } from '@/lib/theme'

let themeSurface: ResolvedTheme = 'light'
let overrideSurface: ResolvedTheme | null = null

// One warning per session: before `npx cap sync` installs the native side, every call
// rejects with "not implemented". Expected, harmless, but worth seeing once in the console.
let warned = false
function warnOnce(err: unknown): void {
  if (warned) return
  warned = true
  console.warn('status-bar: could not set style, continuing with the system default', err)
}

function apply(): void {
  if (!Capacitor.isNativePlatform()) return
  const surface = overrideSurface ?? themeSurface
  // Capacitor names the style after the BACKGROUND: Style.Dark = light text for a dark screen.
  StatusBar.setStyle({ style: surface === 'dark' ? Style.Dark : Style.Light }).catch(warnOnce)
}

/** The app theme just resolved to `surface` (ThemeManager calls this on every change). */
export function syncStatusBarToTheme(surface: ResolvedTheme): void {
  themeSurface = surface
  apply()
}

/** A screen that paints its own fixed surface (the always-dark sign-in) claims the bar; null releases it. */
export function setStatusBarOverride(surface: ResolvedTheme | null): void {
  overrideSurface = surface
  apply()
}
