// Deliberately no providers, auth, navigation or theme switching — one page, no account,
// seen once on a stranger's phone.
import type { Metadata, Viewport } from 'next'
import './globals.css'

// Every page rendered per request: middleware.ts issues a fresh CSP nonce for each response,
// and a page prerendered at build time would carry inline scripts with no nonce, which the
// policy then blocks.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Confirm delivery · FreightProof',
  // Nothing about this page should ever reach a search index: every URL under it carries
  // a live capability token.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // There is deliberately no dark theme (see the note at the top). Saying so lets Android's
  // automatic dark mode leave the page alone instead of inverting it — which would turn the
  // swipe's white thumb on green into something the receiver has never seen.
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  )
}
