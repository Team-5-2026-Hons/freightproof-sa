// Root shell for the receiver app (FP-155).
//
// A Server Component with no providers, no auth, no navigation and no theme switching —
// there is exactly one page in this app and the person reading it has no account. Keeping
// the shell this thin is the point: every provider added here would run on a stranger's
// phone for a page they will see once.
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
