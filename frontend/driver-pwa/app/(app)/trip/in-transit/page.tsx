// frontend/driver-pwa/app/(app)/trip/in-transit/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.
// No dynamic segment here — the trip comes from the driver's session (TripContext),
// not the URL, so no generateStaticParams is needed.

import InTransitPageClient from './InTransitPageClient'

export default function InTransitPage() {
  return <InTransitPageClient />
}
