'use client'

import { Suspense } from 'react'
import { TopBar } from '@/components/ui/TopBar'
import { Spinner } from '@/components/ui/Spinner'
import { SettingsLayout } from '@/components/settings/SettingsLayout'

// Suspense because the open section is read from the URL (useSearchParams), which Next
// requires a boundary for; same arrangement as the parcels and trip detail pages.
export default function SettingsPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar title="Settings" />
      <div className="flex-1 overflow-y-auto p-6">
        <Suspense fallback={<div role="status" aria-label="Loading settings" className="flex justify-center p-12"><Spinner size="lg" /></div>}>
          <SettingsLayout />
        </Suspense>
      </div>
    </div>
  )
}
