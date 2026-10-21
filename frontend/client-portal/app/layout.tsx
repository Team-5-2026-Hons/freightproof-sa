// No providers, auth or navigation: outsiders arrive from a link, read, verify, leave.
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

// Every page rendered per request: middleware.ts issues a fresh CSP nonce for each response,
// and a page prerendered at build time would carry inline scripts with no nonce, which the
// policy then blocks.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Audit pack · FreightProof',
  // Every /p/ URL carries a live share token; nothing here belongs in a search index.
  robots: { index: false, follow: false },
}

// Light only: the design tokens are paper surfaces on ink text, and a browser or extension that
// force-darkens form controls and scrollbars against them produces unreadable combinations.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'light' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={inter.variable}>
      <body className="bg-surf font-sans text-ink antialiased">{children}</body>
    </html>
  )
}
