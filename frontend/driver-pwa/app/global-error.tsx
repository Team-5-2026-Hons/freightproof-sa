'use client'

// Last-resort error boundary: catches crashes in the root layout itself, where
// app/error.tsx can't help. Per the Next.js convention it must render its own
// <html>/<body> because it REPLACES the root layout — which also means the layout's
// providers (Auth/Toast) and font setup are unavailable here. Deliberately
// dependency-free (plain elements + Tailwind utility classes only) so nothing in this
// file can itself crash the boundary of last resort.

import { useEffect } from 'react'

interface GlobalErrorProps {
  // Required Next.js signature: the thrown error (with an optional production digest)
  // plus a reset callback that attempts to re-render the crashed tree.
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Drivers won't report stack traces — log for remote WebView inspection.
    console.error('Global error boundary caught', error)
  }, [error])

  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface font-sans text-surface-on antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
          <div className="w-full rounded-xl bg-error-container px-6 py-8 text-center text-error-on-container">
            <h1 className="text-lg font-bold">Something went wrong</h1>
            <p className="mt-2 text-sm opacity-90">
              The app hit a problem and couldn&rsquo;t finish what it was doing.
              Any photos or details you&rsquo;ve captured are saved on this device — nothing is lost.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3">
            {/* Hand-styled to match Button variant="primary"/"secondary" size="lg" —
                importing the real Button would defeat the dependency-free rule above. */}
            <button
              type="button"
              onClick={reset}
              className="min-h-[52px] w-full rounded-xl bg-primary px-6 py-4 text-sm font-bold uppercase tracking-wider text-primary-on shadow-ambient"
            >
              Try again
            </button>
            {/* Literal "/" instead of ROUTES.home: this file must not import app modules
                (see header comment); a full page load of Home is the safest recovery.
                Plain <a> over next/link is likewise deliberate — the router just
                crashed; a hard document load is the one navigation that can't depend
                on it. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-6 py-4 text-sm font-bold uppercase tracking-wider text-surface-on shadow-ambient-sm"
            >
              Go to Home
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
