'use client'

// Last-resort error boundary: catches crashes in the root layout itself, where
// app/error.tsx can't help. Per the Next.js convention it must render its own
// <html>/<body> because it REPLACES the root layout — which also means the layout's
// providers (Auth/Toast) and font setup are unavailable here. Deliberately
// dependency-free (plain elements + Tailwind utility classes only) so nothing in this
// file can itself crash the boundary of last resort.

import { useEffect } from 'react'

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('Global error boundary caught', error)
  }, [error])

  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface font-sans text-surface-on antialiased">
        <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
          <div className="w-full rounded-xl bg-error-container px-6 py-8 text-center text-error-on-container">
            <h1 className="text-lg font-bold">Something went wrong</h1>
            <p className="mt-2 text-sm opacity-90">
              The app hit a problem and couldn&rsquo;t finish what it was doing.
              Any photos or details you&rsquo;ve captured are saved on this device. Nothing is lost.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3">
            <button
              type="button"
              onClick={reset}
              className="min-h-[52px] w-full rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-on"
            >
              Try Again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-6 py-4 text-base font-semibold text-surface-on"
            >
              Go to Home
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
