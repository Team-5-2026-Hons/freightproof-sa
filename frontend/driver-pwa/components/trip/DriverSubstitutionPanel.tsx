'use client'

import { useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  DriverSubstitutionContextRead,
  SubstitutionNoticeRead,
} from '@shared/lib/types/driver-substitution'
import { fetchDriverSubstitutionContext } from '@/lib/api/driver-substitutions'
import { TripContext } from '@/lib/context/TripContext'
import { ToastContext } from '@/lib/context/ToastContext'
import { useAuth } from '@/lib/hooks/useAuth'
import { useDriverSubstitutions } from '@/lib/hooks/useDriverSubstitutions'
import { tripDetailHref } from '@/lib/navigation/trip-href'
import { noticeCopy, substitutionRoleFor } from '@/lib/utils/driver-substitution'
import { Button } from '@/components/ui/Button'
import { StatusBanner } from '@/components/ui/StatusBanner'
import { DriverSubstitutionCard } from './DriverSubstitutionCard'
import { cn } from '@/lib/utils'

interface NoticeRowProps {
  notice: SubstitutionNoticeRead
  driverId: string
  onOpenTrip: (tripId: string) => void
  onDismiss: (noticeId: string) => Promise<void>
}

function NoticeRow({ notice, driverId, onOpenTrip, onDismiss }: NoticeRowProps) {
  const copy = noticeCopy(notice.kind)
  const [snapshot, setSnapshot] = useState<DriverSubstitutionContextRead | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [isDismissing, setIsDismissing] = useState(false)

  // The arrangement as it stood, for a recipient who wants to know what was cancelled. The
  // contract scopes this read to the snapshot: it never carries the trip's later progress.
  const viewArrangement = async () => {
    setSnapshotError(null)
    try {
      setSnapshot(await fetchDriverSubstitutionContext(notice.trip_id, notice.request_id))
    } catch (err: unknown) {
      console.error('Could not load the cancelled arrangement', err)
      setSnapshotError('Could not load the arrangement. Check your connection and try again.')
    }
  }

  const dismiss = async () => {
    setIsDismissing(true)
    try {
      await onDismiss(notice.id)
    } finally {
      setIsDismissing(false)
    }
  }

  const snapshotRole = snapshot !== null ? substitutionRoleFor(snapshot, driverId) : null

  return (
    <div className="flex flex-col gap-2">
      <StatusBanner tone={notice.kind === 'completed' ? 'success' : 'attention'} title={copy.title} live>
        {copy.body}
      </StatusBanner>
      <div className="flex flex-wrap gap-2">
        {notice.kind === 'completed' && (
          // Role-agnostic on purpose: the trip page asks the server, which answers with
          // current work for the incoming driver and TRIP_HANDED_OVER → history for the
          // outgoing one. The notice itself never decides who holds the trip.
          <Button variant="fill" size="pill-sm" onClick={() => onOpenTrip(notice.trip_id)}>Open trip</Button>
        )}
        {notice.kind === 'cancelled' && snapshot === null && (
          <Button variant="fill" size="pill-sm" onClick={() => void viewArrangement()}>View arrangement</Button>
        )}
        <Button variant="fill" size="pill-sm" loading={isDismissing} onClick={() => void dismiss()}>Dismiss</Button>
      </div>
      {snapshotError !== null && <p className="text-subhead text-error">{snapshotError}</p>}
      {snapshot !== null && snapshotRole !== null && (
        <DriverSubstitutionCard request={snapshot} role={snapshotRole} context={snapshot} />
      )}
    </div>
  )
}

/**
 * Everything substitution-related a driver must not miss, wherever they are (Home, Trips):
 * the trip they just handed over, unread notices, and each pending arrangement naming them.
 * Renders nothing when there is none of that — including for a driver with no current trip,
 * who still sees an incoming collection here.
 */
export function DriverSubstitutionPanel({ className }: { className?: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const { pending, notices, markNoticeRead } = useDriverSubstitutions()
  // Optional, like the provider's own read: Home/Trips test harnesses render without it.
  const tripCtx = useContext(TripContext)
  const toastCtx = useContext(ToastContext)
  const handedOverTripId = tripCtx?.handedOverTripId ?? null

  if (user === null) return null
  const driverId = String(user.id)
  const cards = pending
    .map((request) => ({ request, role: substitutionRoleFor(request, driverId) }))
    .filter((item): item is { request: typeof item.request; role: NonNullable<typeof item.role> } => item.role !== null)

  if (handedOverTripId === null && notices.length === 0 && cards.length === 0) return null

  const openTrip = (tripId: string) => router.push(tripDetailHref(tripId))

  const dismissNotice = async (noticeId: string) => {
    try {
      await markNoticeRead(noticeId)
    } catch (err: unknown) {
      // Kept on screen: a notice that vanished locally but stayed unread on the server
      // would come back on the next refresh looking like a new handover.
      console.error('Could not mark the handover notice read', err)
      toastCtx?.notify({ kind: 'error', title: 'Could not dismiss', body: 'Check your connection and try again.' })
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {handedOverTripId !== null && (
        <div className="flex flex-col gap-2">
          <StatusBanner tone="neutral" title="You handed over this trip" live>
            You are no longer the driver on it. Everything you recorded is kept in your record.
          </StatusBanner>
          <div className="flex flex-wrap gap-2">
            <Button variant="fill" size="pill-sm" onClick={() => openTrip(handedOverTripId)}>View your record</Button>
            <Button variant="fill" size="pill-sm" onClick={() => tripCtx?.dismissHandedOver()}>Dismiss</Button>
          </div>
        </div>
      )}
      {notices.map((notice) => (
        <NoticeRow key={notice.id} notice={notice} driverId={driverId} onOpenTrip={openTrip} onDismiss={dismissNotice} />
      ))}
      {cards.map(({ request, role }) => (
        <DriverSubstitutionCard key={request.id} request={request} role={role} />
      ))}
    </div>
  )
}
