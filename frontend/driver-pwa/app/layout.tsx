import type { Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/context/AuthContext'
import { ToastProvider } from '@/lib/context/ToastContext'

// AuthProvider/ToastProvider are themselves 'use client' — this file stays a Server
// Component so `viewport` (below) can be statically exported. Next.js forbids exporting
// `viewport`/`metadata` from a 'use client' file (build fails: "viewport() ... on the
// client"). Nothing in this file needs client-side hooks, so no wrapper is needed.

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
