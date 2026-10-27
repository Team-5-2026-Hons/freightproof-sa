// Deliberately no providers, auth, navigation or theme switching — one page, no account,
// seen once on a stranger's phone.
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Confirm delivery · FreightProof',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  )
}
