import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/context/AuthContext'
import { ToastProvider } from '@/lib/context/ToastContext'

// AuthProvider/ToastProvider are themselves 'use client' — this file stays a Server
// Component so `viewport`/`metadata` (below) can be statically exported. Next.js forbids
// exporting `viewport`/`metadata` from a 'use client' file (build fails: "viewport() ... on
// the client"). Nothing in this file needs client-side hooks, so no wrapper is needed.

// TripProvider is wired in app/(app)/layout.tsx (Phase 1) — not here,
// because it is only needed inside the authenticated route group.

// viewportFit: 'cover' lets content draw under the Android WebView's notch/gesture-bar
// insets (env(safe-area-inset-*) below only resolves to non-zero values with this set) —
// without it every bottom-anchored control (HoldButton, panic Cancel) sits flush against
// the gesture bar with zero clearance.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
    <html lang="en" className={inter.variable}>
      <body className="font-sans bg-surface text-surface-on antialiased min-h-dvh">
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
