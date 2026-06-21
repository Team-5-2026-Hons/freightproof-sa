// frontend/driver-pwa/app/(app)/trip/[id]/in-transit/page.tsx
//
// Server component (no 'use client'): Next.js requires generateStaticParams to be
// exported from a server module, but every driver-pwa page must otherwise be a client
// component (output: 'export' is incompatible with Server Components). This file is the
// minimal server-side wrapper — all rendering logic lives in InTransitPageClient.
import { mockTrips } from '@shared/lib/mocks/trips'
import InTransitPageClient from './InTransitPageClient'

// Static export (output: 'export') requires every dynamic segment to declare its
// param combinations at build time. Trip data is mock-only for now, so we enumerate
// directly from the fixture set — swap for a real trip-id fetch once Iter 2 lands.
export function generateStaticParams() {
  return mockTrips.map((trip) => ({ id: String(trip.id) }))
}

export default function InTransitPage() {
  return <InTransitPageClient />
}
