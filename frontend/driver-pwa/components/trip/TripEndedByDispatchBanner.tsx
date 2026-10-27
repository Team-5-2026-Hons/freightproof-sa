'use client'

import { useContext } from 'react'
import { useRouter } from 'next/navigation'
import { TripContext } from '@/lib/context/TripContext'
import { tripDetailHref } from '@/lib/navigation/trip-href'
import { formatDateTime } from '@/lib/utils/format-time'
import { StatusBanner } from '@/components/ui/StatusBanner'
import { Button } from '@/components/ui/Button'
import { CallDispatch } from '@/components/trip/CallDispatch'
import { cn } from '@/lib/utils'

/**
 * Said once when dispatch ends the trip this driver was on, instead of the trip silently
 * disappearing. The words are deliberately plain: no reason, no "incident", no "hijacking".
 * After a hijacking this phone may be in someone else's hands, and it must not learn that a
 * report was made. Everything already recorded, and anything still queued, is kept.
 */
export function TripEndedByDispatchBanner({ className }: { className?: string }) {
  const router = useRouter()
  const ended = useContext(TripContext)?.endedByDispatch ?? null
  const dismiss = useContext(TripContext)?.dismissEndedByDispatch
  if (ended === null) return null

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <StatusBanner tone="neutral" title="Dispatch has ended this trip" live>
        Trip {ended.tripReference}{ended.endedAt ? ` ended at ${formatDateTime(ended.endedAt)}` : ' has ended'}.
        There is nothing more to do on it. Everything you recorded is kept.
      </StatusBanner>
      <CallDispatch />
      <div className="flex flex-wrap gap-2">
        <Button variant="fill" size="pill-sm" onClick={() => router.push(tripDetailHref(ended.tripId))}>View your record</Button>
        <Button variant="fill" size="pill-sm" onClick={() => dismiss?.()}>Dismiss</Button>
      </div>
    </div>
  )
}
