// Deliberately no providers, auth, navigation or theme switching — one page, no account,
// seen once on a stranger's phone.
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Confirm delivery · FreightProof',
  // Nothing about this page should ever reach a search index: every URL under it carries
  // a live capability token.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  )
}
