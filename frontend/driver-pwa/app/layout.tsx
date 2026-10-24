import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/context/AuthContext'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ThemeManager } from '@/components/theme/ThemeManager'
import { TextSizeCap } from '@/components/theme/TextSizeCap'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

// Server Component (not 'use client') so viewport/metadata below can be statically exported.
// TripProvider is wired in app/(app)/layout.tsx, only inside the authenticated route group.

// viewportFit: 'cover' lets content draw under the WebView's notch/gesture-bar insets, so
// bottom-anchored controls (SwipeToConfirm, panic Cancel) get real clearance.
// maximumScale/userScalable lock pinch-zoom: this ships as a packaged native shell
// (Capacitor), so an input focus must not trigger iOS's zoom-to-focused-field. Drivers who
// need larger text get it from Dynamic Type instead — globals.css binds 1rem to it.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

// statusBarStyle: 'black' matches the native Capacitor shell's black Android status bar
// (android/app/src/main/res/values/styles.xml), kept consistent for iOS/Android PWA launches.
export const metadata: Metadata = {
  title: 'FreightProof Driver',
  description: 'FreightProof SA · Driver evidence capture app',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'FreightProof',
    statusBarStyle: 'black',
  },
}


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-paint script below writes the theme class before
    // React hydrates, so server and client class lists legitimately differ on first pass.
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans bg-surface text-surface-on antialiased min-h-dvh">
        {/* First child of <body>: runs before paint, avoiding a white flash. See lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeManager />
        <TextSizeCap />
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
