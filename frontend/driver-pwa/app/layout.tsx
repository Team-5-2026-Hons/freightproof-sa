import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/lib/context/AuthContext'
import { ToastProvider } from '@/lib/context/ToastContext'
import { ThemeManager } from '@/components/theme/ThemeManager'
import { TextSizeCap } from '@/components/theme/TextSizeCap'
import { THEME_INIT_SCRIPT } from '@/lib/theme'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

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
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans bg-surface text-surface-on antialiased min-h-dvh">
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
