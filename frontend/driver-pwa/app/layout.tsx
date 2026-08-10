import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/context/AuthContext'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ThemeManager } from '@/components/theme/ThemeManager'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

// AuthProvider/ToastProvider are themselves 'use client' — this file stays a Server
// Component so `viewport`/`metadata` (below) can be statically exported. Next.js forbids
// exporting `viewport`/`metadata` from a 'use client' file (build fails: "viewport() ... on
// the client"). Nothing in this file needs client-side hooks, so no wrapper is needed.

// TripProvider is wired in app/(app)/layout.tsx (Phase 1) — not here,
// because it is only needed inside the authenticated route group.

// viewportFit: 'cover' lets content draw under the Android WebView's notch/gesture-bar
// insets (env(safe-area-inset-*) below only resolves to non-zero values with this set) —
// without it every bottom-anchored control (SwipeToConfirm, panic Cancel) sits flush against
// the gesture bar with zero clearance.
//
// maximumScale/userScalable lock pinch-zoom: this ships as a packaged native app shell
// (Capacitor), not a browsable page, so iOS's WKWebView must render at a fixed 1:1 scale
// like any other native screen. Without this lock, focusing any <16px input triggers
// iOS's automatic zoom-to-focused-field, and the app is left zoomed in with no way back out.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

// Links public/manifest.json into the rendered <head> — without this the manifest file
// exists but is never referenced, so the browser PWA is never installable. statusBarStyle:
// 'black' matches the native Capacitor shell's deliberate black Android status bar
// (android/app/src/main/res/values/styles.xml — AppTheme.NoActionBarLaunch), kept
// consistent here for iOS "Add to Home Screen" and Android Chrome standalone launches.
export const metadata: Metadata = {
  title: 'FreightProof Driver',
  description: 'FreightProof SA — Driver evidence capture app',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'FreightProof',
    statusBarStyle: 'black',
  },
}

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-paint script below writes the theme class onto
    // this same element before React hydrates, so the server-rendered class list and the
    // client's will legitimately differ on first pass. Scoped to <html> only — it does
    // not suppress anything inside the app.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans bg-surface text-surface-on antialiased min-h-dvh">
        {/* First child of <body>, so it runs while the parser is still blocked and the
            page has not painted yet. Anything later — including a component — is too
            late and shows a white flash before flipping to dark. See lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeManager />
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
