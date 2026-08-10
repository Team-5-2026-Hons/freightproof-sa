// frontend/driver-pwa/app/(app)/trips/active/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.
// No dynamic segment here — the trip comes from the driver's session (TripContext),
// not the URL, so no generateStaticParams is needed.

import ActiveTripPageClient from './ActiveTripPageClient'

export default function ActiveTripPage() {
  return <ActiveTripPageClient />
}
