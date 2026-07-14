// frontend/driver-pwa/app/(app)/trip/panic/submitted/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.
// No dynamic segment here — the trip comes from the driver's session (TripContext),
// not the URL, so no generateStaticParams is needed.

import { Suspense } from 'react'
import PanicSubmittedPageClient from './PanicSubmittedPageClient'

// useSearchParams() (used inside PanicSubmittedPageClient to tell a sent alert apart
// from a queued one) opts a page out of static rendering unless wrapped in Suspense —
// required for the static export (output: 'export') build. Mirrors app/otp/page.tsx.
export default function PanicSubmittedPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-surface-on-variant">Loading…</p>
        </main>
      }
    >
      <PanicSubmittedPageClient />
    </Suspense>
  )
}
