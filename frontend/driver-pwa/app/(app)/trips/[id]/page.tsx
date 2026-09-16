// Server component: generateStaticParams must run server-side, but driver-pwa otherwise
// requires 'use client' everywhere (output: 'export'). Rendering lives in TripDetailPageClient.
import { mockTrips } from '@shared/lib/mocks/trips'
import TripDetailPageClient from './TripDetailPageClient'

// Trip data is mock-only for now; swap for a real trip-id fetch once Iter 2 lands.
export function generateStaticParams() {
  return mockTrips.map((trip) => ({ id: String(trip.id) }))
}

export default function TripDetailPage() {
  return <TripDetailPageClient />
}
