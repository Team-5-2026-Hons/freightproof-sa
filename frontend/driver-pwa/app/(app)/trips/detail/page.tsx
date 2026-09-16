'use client'

// The trip id arrives as a query param (?id=<uuid>), not a path segment, since static
// export can't enumerate real trip UUIDs via generateStaticParams — unlike trips/[id],
// which only resolves mock fixture ids.

import { Suspense } from 'react'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import TripDetailByIdPageClient from './TripDetailByIdPageClient'

// useSearchParams() requires Suspense for the output: 'export' build.
export default function TripDetailByIdPage() {
  return (
    <Suspense fallback={<LoadingScreen label="Loading trip" />}>
      <TripDetailByIdPageClient />
    </Suspense>
  )
}
