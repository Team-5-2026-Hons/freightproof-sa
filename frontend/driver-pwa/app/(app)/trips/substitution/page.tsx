'use client'

// The trip and arrangement ids arrive as query params, not path segments: static export
// cannot enumerate real UUIDs (same reason as trips/detail).

import { Suspense } from 'react'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import SubstitutionPageClient from './SubstitutionPageClient'

export default function SubstitutionPage() {
  return (
    <Suspense fallback={<LoadingScreen label="Loading handover" />}>
      <SubstitutionPageClient />
    </Suspense>
  )
}
