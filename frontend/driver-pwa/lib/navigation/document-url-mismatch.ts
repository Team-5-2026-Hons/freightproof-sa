// Recognising the one state the driver cannot get out of: Home's document served under
// another screen's URL.
//
// Capacitor returns index.html for ANY path with no file extension that it cannot resolve
// to a file — iOS in CapacitorRouter.route(for:), Android via html5mode. Every in-app
// route here is extension-less: the static export writes
// out/trip/phase/loading/step/1-linehaul.html, and the app only ever addresses it as
// /trip/phase/loading/step/1-linehaul, so a reload of any screen but Home is answered with
// Home's document.
//
// iOS performs exactly that reload unprompted. When the WKWebView content process is
// reclaimed — the driver is in the native document scanner while this step holds a scan
// data URL, a pdf-lib build and two uploads in memory — Capacitor's
// webViewWebContentProcessDidTerminate() calls webView.reload() on the CURRENT url, the
// step's. Next 15 then takes its canonical URL from window.location
// (create-initial-router-state.js), so the app renders Home's page tree under the step's
// pathname. Two things follow, and together they trap the driver:
//
//   - isFullBleedRoute() matches '/trip/phase/', so AppShell is skipped: no tab bar to
//     escape with and no safe-area header, which is why the greeting sat under the clock.
//   - app/(app)/template.tsx's cold-start resume is gated on pathname === '/', so it never
//     fires and the remembered step is never replayed.
//
// Force-quitting is the only way out, because a relaunch loads the configured start URL
// ('/') rather than the dead screen's. Home's page is the one place that can notice, since
// it is the only page that belongs at '/' — see app/(app)/page.tsx.
//
// ios/App/App/MainViewController.swift now resolves these paths to their real exported
// .html, so the reload should land on the right screen. This stays as the cross-platform
// net: it covers the browser PWA, any host that falls back to index.html, and an iOS build
// shipped before that native change.

export const HOME_PATH = '/'

// The paths that genuinely ARE Home. '/index.html' because a WebView may reload the
// resolved filename rather than the clean URL, and a trailing slash because nothing
// guarantees which form the reload uses.
const HOME_PATHNAMES: readonly string[] = ['', '/', '/index.html']

/**
 * True when Home's own document has been served for some other screen's URL, which means
 * the WebView reloaded a route it could not resolve. Pure, so it is the part under test:
 * the recovery itself is a navigation.
 */
export function isStrandedHomeDocument(pathname: string): boolean {
  // Trailing slashes only: a path is never collapsed further, so '/trips/' stays a
  // non-Home route rather than being normalised into one.
  const trimmed = pathname.replace(/\/+$/, '')
  return !HOME_PATHNAMES.includes(trimmed)
}
