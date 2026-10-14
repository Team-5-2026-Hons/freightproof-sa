// frontend/driver-pwa/app/(app)/trip/panic/page.tsx
'use client'

// No dynamic segment: trip comes from TripContext, not the URL — no generateStaticParams needed.

import PanicPageClient from './PanicPageClient'

export default function PanicPage() {
  return <PanicPageClient />
}
