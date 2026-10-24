'use client'

import { useSearchParams } from 'next/navigation'
import { ROUTES, SUBSTITUTION_REQUEST_PARAM, SUBSTITUTION_TRIP_PARAM } from '@/lib/constants/routes'
import { useAuth } from '@/lib/hooks/useAuth'
import { useBack } from '@/lib/navigation/useBack'
import { TabSubpage } from '@/components/layout/TabSubpage'
import { StatusBanner } from '@/components/ui/StatusBanner'
import { DriverSubstitutionFlow } from '@/components/trip/DriverSubstitutionFlow'

/** The signed-in driver's own handover or takeover check for one arrangement. */
export default function SubstitutionPageClient() {
  const searchParams = useSearchParams()
  const goBack = useBack(ROUTES.home)
  const { user } = useAuth()
  const tripId = searchParams.get(SUBSTITUTION_TRIP_PARAM)
  const requestId = searchParams.get(SUBSTITUTION_REQUEST_PARAM)

  return (
    <TabSubpage title="Driver handover" backLabel="Back" onBack={goBack}>
      {tripId === null || requestId === null || user === null ? (
        <StatusBanner tone="attention" title="Handover not found" className="mx-4 mt-4">
          Open the handover again from your Home screen.
        </StatusBanner>
      ) : (
        <DriverSubstitutionFlow tripId={tripId} requestId={requestId} actorId={String(user.id)} />
      )}
    </TabSubpage>
  )
}
