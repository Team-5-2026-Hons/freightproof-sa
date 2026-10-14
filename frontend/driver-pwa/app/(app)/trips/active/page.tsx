// frontend/driver-pwa/app/(app)/trips/active/page.tsx
'use client'

// No dynamic segment: trip comes from TripContext, not the URL — no generateStaticParams needed.

import ActiveTripPageClient from './ActiveTripPageClient'

export default function ActiveTripPage() {
  return <ActiveTripPageClient />
}
