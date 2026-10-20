'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { ROUTES } from '@/lib/constants/routes'
import { useBack } from '@/lib/navigation/useBack'
import { TabSubpage } from '@/components/layout/TabSubpage'
import { RetainedEvidenceList } from '@/components/offline/RetainedEvidenceList'

/**
 * FP-83: captures this phone is keeping for the driver's decision — refused by the server,
 * kept after a handover, or saved before the app recorded who captured them.
 */
export default function RetainedEvidencePage() {
  const goBack = useBack(ROUTES.home)
  return (
    <TabSubpage title="Kept on this phone" backLabel="Back" onBack={goBack}>
      <RetainedEvidenceList />
    </TabSubpage>
  )
}
