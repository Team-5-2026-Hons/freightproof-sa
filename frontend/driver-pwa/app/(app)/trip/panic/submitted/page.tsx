'use client'

// No dynamic segment: trip comes from TripContext, not the URL — no generateStaticParams needed.

import { Suspense } from 'react'
import PanicSubmittedPageClient from './PanicSubmittedPageClient'

// useSearchParams() requires Suspense for the output: 'export' build. Mirrors app/otp/page.tsx.
export default function PanicSubmittedPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center">
          <p className="text-sm text-surface-on-variant">Loading…</p>
        </main>
      }
    >
      <PanicSubmittedPageClient />
    </Suspense>
  )
}
