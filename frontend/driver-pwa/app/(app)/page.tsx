// frontend/driver-pwa/app/(app)/page.tsx
'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { HomeContent } from '@/components/home/HomeContent'

export default function HomePage() {
  return <HomeContent />
}
