import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/context/AuthContext'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ThemeManager } from '@/components/theme/ThemeManager'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

// Server Component (not 'use client') so viewport/metadata below can be statically exported.
// TripProvider is wired in app/(app)/layout.tsx, only inside the authenticated route group.

// viewportFit: 'cover' lets content draw under the WebView's notch/gesture-bar insets, so
// bottom-anchored controls (SwipeToConfirm, panic Cancel) get real clearance.
// maximumScale/userScalable lock pinch-zoom: this ships as a packaged native shell
// (Capacitor), so an input focus must not trigger iOS's zoom-to-focused-field.
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
    // suppressHydrationWarning: the pre-paint script below writes the theme class before
    // React hydrates, so server and client class lists legitimately differ on first pass.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans bg-surface text-surface-on antialiased min-h-dvh">
        {/* First child of <body>: runs before paint, avoiding a white flash. See lib/theme.ts. */}
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
