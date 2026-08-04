// frontend/driver-pwa/app/(app)/trips/detail/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.
//
// The trip id arrives as a QUERY PARAM (?id=<uuid>), not a path segment, and that is the
// whole reason this route exists alongside trips/[id]. Static export must enumerate every
// dynamic path segment at build time via generateStaticParams, and a real trip's UUID
// never is — trips/[id] can therefore only ever resolve the mock fixture ids it was built
// from. One static route plus a query param serves every real trip instead.

import { Suspense } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import TripDetailByIdPageClient from './TripDetailByIdPageClient'

// useSearchParams() (used inside the client below to read ?id) opts a page out of static
// rendering unless wrapped in Suspense — required for the output: 'export' build.
// Mirrors app/(app)/trip/panic/submitted/page.tsx.
export default function TripDetailByIdPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center">
          <Spinner />
        </main>
      }
    >
      <TripDetailByIdPageClient />
    </Suspense>
  )
}
