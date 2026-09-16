// frontend/driver-pwa/app/(app)/trip/in-transit/exception/page.tsx
'use client'

// No dynamic segment: trip comes from TripContext, not the URL — no generateStaticParams needed.

import LogExceptionPageClient from './LogExceptionPageClient'

export default function LogExceptionPage() {
  return <LogExceptionPageClient />
}
