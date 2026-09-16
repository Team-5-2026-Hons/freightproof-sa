// frontend/driver-pwa/app/(app)/trip/in-transit/page.tsx
'use client'

// No dynamic segment: trip comes from TripContext, not the URL — no generateStaticParams needed.

import InTransitPageClient from './InTransitPageClient'

export default function InTransitPage() {
  return <InTransitPageClient />
}
