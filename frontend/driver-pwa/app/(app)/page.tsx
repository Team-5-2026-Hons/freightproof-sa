'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useEffect, useState } from 'react'
import { HomeContent } from '@/components/home/HomeContent'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { HOME_PATH, isStrandedHomeDocument } from '@/lib/navigation/document-url-mismatch'

export default function HomePage() {
  const [isRecovering, setIsRecovering] = useState(false)

  useEffect(() => {
    if (!isStrandedHomeDocument(window.location.pathname)) return
    setIsRecovering(true)
    window.location.replace(HOME_PATH)
  }, [])

  if (isRecovering) return <LoadingScreen label="Restoring your trip" />

  return <HomeContent />
}
