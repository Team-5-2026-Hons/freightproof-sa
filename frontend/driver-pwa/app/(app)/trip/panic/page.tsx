// frontend/driver-pwa/app/(app)/trip/panic/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.
// No dynamic segment here — the trip comes from the driver's session (TripContext),
// not the URL, so no generateStaticParams is needed.

import PanicPageClient from './PanicPageClient'

export default function PanicPage() {
  return <PanicPageClient />
}
