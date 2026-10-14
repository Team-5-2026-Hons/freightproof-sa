// frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/page.tsx
'use client'

// No dynamic segment: trip comes from TripContext, not the URL — no generateStaticParams needed.

import CheckpointPageClient from './CheckpointPageClient'

export default function CheckpointPage() {
  return <CheckpointPageClient />
}
