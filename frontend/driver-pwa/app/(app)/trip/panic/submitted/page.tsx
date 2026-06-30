// frontend/driver-pwa/app/(app)/trip/panic/submitted/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.
// No dynamic segment here — the trip comes from the driver's session (TripContext),
// not the URL, so no generateStaticParams is needed.

import PanicSubmittedPageClient from './PanicSubmittedPageClient'

export default function PanicSubmittedPage() {
  return <PanicSubmittedPageClient />
}
