'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'
import { markTransition } from '@/lib/navigation/transition-direction'

/**
 * Settings merged into Profile. The path is kept as a
 * redirect so a bookmark, an installed PWA's saved state or a stale in-app link still
 * lands somewhere real. A static export cannot issue an HTTP redirect, hence the client
 * replace; replace (not push) so Back never returns to this empty hop.
 */
export default function SettingsPage() {
  const router = useRouter()

  useEffect(() => {
    markTransition('none')
    router.replace(ROUTES.profile)
  }, [router])

  return null
}
