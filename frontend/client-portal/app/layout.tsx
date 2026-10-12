// No providers, auth or navigation: outsiders arrive from a link, read, verify, leave.
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: 'Audit pack · FreightProof',
  // Every /p/ URL carries a live share token; nothing here belongs in a search index.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={inter.variable}>
      <body className="bg-surf font-sans text-ink antialiased">{children}</body>
    </html>
  )
}
