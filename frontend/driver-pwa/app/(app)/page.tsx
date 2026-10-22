// frontend/driver-pwa/app/(app)/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useEffect, useState } from 'react'
import { HomeContent } from '@/components/home/HomeContent'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { HOME_PATH, isStrandedHomeDocument } from '@/lib/navigation/document-url-mismatch'

export default function HomePage() {
  // This page's own document is what Capacitor hands back for any URL it cannot resolve,
  // so finding ourselves anywhere but '/' means the WebView reloaded a deep route and got
  // Home instead — see lib/navigation/document-url-mismatch.ts for how a driver ends up
  // here and why they cannot leave. A hard load of '/' is the only way out: the router
  // believes it is already on this pathname, so router.replace() would be a no-op, and
  // the page tree it holds is Home's whatever we ask it for. It is also what lets
  // template.tsx's cold-start resume replay the step they were on.
  const [isRecovering, setIsRecovering] = useState(false)

  useEffect(() => {
    if (!isStrandedHomeDocument(window.location.pathname)) return
    // Set before navigating: the reload is not instant, and "No trip assigned" is a lie
    // to show a driver who is mid-trip.
    setIsRecovering(true)
    window.location.replace(HOME_PATH)
  }, [])

  if (isRecovering) return <LoadingScreen label="Restoring your trip" />

  return <HomeContent />
}
