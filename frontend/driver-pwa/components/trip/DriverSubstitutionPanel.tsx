'use client'

import { useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import type {
  DriverSubstitutionContextRead,
  SubstitutionNoticeRead,
  SubstitutionRequestRead,
  SubstitutionRole,
} from '@shared/lib/types/driver-substitution'
import { fetchDriverSubstitutionContext } from '@/lib/api/driver-substitutions'
import { TripContext } from '@/lib/context/TripContext'
import { ToastContext } from '@/lib/context/ToastContext'
import { useAuth } from '@/lib/hooks/useAuth'
import { useDriverSubstitutions } from '@/lib/hooks/useDriverSubstitutions'
import { tripDetailHref } from '@/lib/navigation/trip-href'
import { noticeCopy, substitutionRoleFor } from '@/lib/utils/driver-substitution'
import { attentionItemIds, markAttentionSeen, unseenAttentionItems } from '@/lib/utils/substitution-attention'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { StatusBanner } from '@/components/ui/StatusBanner'
import { DriverSubstitutionCard } from './DriverSubstitutionCard'
import { cn } from '@/lib/utils'

export const HANDOVER_SHEET_TITLE = 'Driver handover'
// How many trip references the compact row names before it says "and N more".
const SUMMARY_REFERENCE_LIMIT = 2

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

interface PendingCard {
  request: SubstitutionRequestRead
  role: SubstitutionRole
}

/** The one-line summary on the compact row: what is waiting, by trip reference. */
export function attentionSummary(cards: readonly PendingCard[], noticeCount: number, handedOver: boolean): string {
  const parts: string[] = []
  if (cards.length > 0) {
    const references = cards.slice(0, SUMMARY_REFERENCE_LIMIT).map((card) => card.request.trip_reference)
    const more = cards.length - references.length
    const verb = cards.every((card) => card.role === 'incoming') ? 'Collect' : cards.every((card) => card.role === 'outgoing') ? 'Hand over' : 'Arrangements for'
    parts.push(`${verb} ${references.join(', ')}${more > 0 ? ` and ${more} more` : ''}`)
  }
  if (noticeCount > 0) parts.push(noticeCount === 1 ? '1 notice' : `${noticeCount} notices`)
  if (handedOver) parts.push('Trip handed over')
  return parts.join(' · ')
}

/**
 * Everything substitution-related a driver must not miss, wherever they are (Home, Trips):
 * the trip they just handed over, unread notices, and each pending arrangement naming them.
 * Shown as a bottom sheet that opens itself once for anything the driver has not been shown
 * this session, with a compact row that keeps it one tap away afterwards. Renders nothing
 * when there is none of that — including for a driver with no current trip, who still sees
 * an incoming collection here.
 */
export function DriverSubstitutionPanel({ className }: { className?: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const { pending, notices, markNoticeRead } = useDriverSubstitutions()
  // Optional, like the provider's own read: Home/Trips test harnesses render without it.
  const tripCtx = useContext(TripContext)
  const toastCtx = useContext(ToastContext)
  const handedOverTripId = tripCtx?.handedOverTripId ?? null
  const [open, setOpen] = useState(false)

  const driverId = user === null ? null : String(user.id)
  const cards: PendingCard[] = driverId === null ? [] : pending
    .map((request) => ({ request, role: substitutionRoleFor(request, driverId) }))
    .filter((item): item is PendingCard => item.role !== null)

  // One string per render so the effect below runs only when the SET of items changes, not
  // on every poll that returns the same arrangements.
  const itemIds = attentionItemIds(cards.map((card) => card.request), notices, handedOverTripId)
  const itemKey = itemIds.join('|')
  useEffect(() => {
    if (itemKey === '') return
    const unseen = unseenAttentionItems(itemKey.split('|'))
    if (unseen.length === 0) return
    // Marked seen as it opens, not as it closes: the sheet interrupts once per item, and
    // navigating away from inside it must not count as "never shown".
    markAttentionSeen(unseen)
    setOpen(true)
  }, [itemKey])

  if (driverId === null) return null
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
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-[56px] w-full items-center gap-3 rounded-[22px] bg-fill px-4 py-3 text-left transition-transform duration-100 active:scale-[0.98]"
      >
        <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-headline text-surface-on">{HANDOVER_SHEET_TITLE}</span>
          <span className="block truncate text-subhead text-surface-on-variant">
            {attentionSummary(cards, notices.length, handedOverTripId !== null)}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-surface-on-variant" strokeWidth={2} />
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} side="bottom" title={HANDOVER_SHEET_TITLE}>
        {/* The Drawer pads its own body, so only the gap between items is set here. */}
        <div className="flex flex-col gap-4">
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
      </Drawer>
    </div>
  )
}
