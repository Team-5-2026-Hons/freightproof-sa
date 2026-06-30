// frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.
// No dynamic segment here — the trip comes from the driver's session (TripContext),
// not the URL, so no generateStaticParams is needed.

import CheckpointPageClient from './CheckpointPageClient'

export default function CheckpointPage() {
  return <CheckpointPageClient />
}
