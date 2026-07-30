'use client'

import { useRouter } from 'next/navigation'
import { Chip } from '@/components/ui/Chip'
import { TripIdStamp } from './TripIdStamp'
import { PhaseChain } from './PhaseChain'
import { ROUTES } from '@/lib/constants/routes'
import type { TripSummary } from '@shared/lib/types/trip'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { chainNodesFromCounts, tripChipMeta } from '@/lib/phase/derive'
import type { Precinct } from '@shared/lib/types/precinct'
import { cn } from '@shared/lib/utils/cn'

export interface ColWidths {
  createdAt: number
  tripId: number
  order:  number
  driver: number
  route:  number
  progress: number
  status: number
}

interface ChecklistRowProps {
  trip: TripSummary
  colWidths: ColWidths
  precincts: Precinct[]
  className?: string
  // History table hides the phase progress chain — trips there are already
  // complete or cancelled, so only whether exceptions occurred still matters.
  showProgress?: boolean
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

// What the row says the trip is doing. Exceptions win: a dispatcher must see them
// before anything else. Otherwise the coarse status covers the terminal states and
// current_phase covers everything in between — derived server-side from the ledger,
// never inferred from trip.status the way the three deleted tables did.
function progressHint(trip: TripSummary): string {
  if (trip.open_exception_count > 0) {
    return `⚠ ${trip.open_exception_count} exception${trip.open_exception_count > 1 ? 's' : ''}`
  }
  if (trip.status === 'closed')    return '✓ Closed'
  if (trip.status === 'cancelled') return 'Cancelled'
  if (trip.current_phase === null) return 'Pending start'

  const stop = trip.current_stop === null ? '' : ` · stop ${trip.current_stop}`
  return `${PHASE_NAMES[trip.current_phase]}${stop} · ${trip.phase_completed}/${trip.phase_total}`
}

export function ChecklistRow({ trip, colWidths, precincts, className, showProgress = true }: ChecklistRowProps) {
  const router = useRouter()

  // U13: the chip names the phase — `Unloading`, not `Active`; `⚠ Unloading` when
  // held. The list reads the cache because it has no plan to derive from; that is
  // U3's read-path exemption, and the ONLY place in the dispatcher allowed to do it.
  const statusMeta = tripChipMeta(trip.status, trip.current_phase)

  const originPrecinct = precincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct   = precincts.find(p => p.id === trip.destination_precinct_id)

  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? '—'
  const destShort   = destPrecinct?.name.split('—')[0]?.trim() ?? '—'

  const chainNodes = chainNodesFromCounts(
    trip.phase_total,
    trip.phase_completed,
    trip.current_phase === null ? '' : PHASE_NAMES[trip.current_phase],
  )

  const hint = progressHint(trip)

  function navigate() { router.push(ROUTES.tripDetail(trip.id)) }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={navigate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate() }}
      className={cn(
        'w-full flex items-center px-6 py-3 text-left',
        'bg-surf-lowest cursor-pointer transition-colors duration-[120ms]',
        'hover:bg-surf-low divide-x divide-outline/30',
        // Left border accent draws the eye when a trip needs attention
        trip.open_exception_count > 0 && 'border-l-4 border-err',
        className,
      )}
    >
      {/* Date created — small, subtle, reference only */}
      <div style={{ width: colWidths.createdAt }} className="shrink-0 pr-[6px] text-[11px] text-on-surf-v tabular-nums">
        {formatShortDate(trip.created_at)}
      </div>

      {/* Trip ID */}
      <div style={{ width: colWidths.tripId }} className="shrink-0 overflow-hidden px-[6px] text-[13px] font-[600] text-sec tabular-nums tracking-[0.05em]">
        <TripIdStamp tripReference={trip.trip_reference} />
      </div>

      {/* Order number */}
      <div style={{ width: colWidths.order }} className="shrink-0 px-[6px] text-[11px] text-on-surf-v tabular-nums tracking-[0.03em] truncate">
        {trip.order_number}
      </div>

      {/* Driver + Horse */}
      <div style={{ width: colWidths.driver }} className="shrink-0 min-w-0 px-[6px]">
        <div className="text-[14px] font-[600] text-on-surf truncate">{trip.driver.full_name}</div>
        <div className="text-[11px] text-on-surf-v tabular-nums tracking-[0.04em] truncate">
          {trip.horse?.registration ?? '—'}
        </div>
      </div>

      {/* Route — origin/destination stacked so neither gets cut off in a narrow column */}
      <div style={{ width: colWidths.route }} className="shrink-0 min-w-0 px-[6px]">
        <div className="text-[13px] font-[600] text-on-surf truncate">{originShort}</div>
        <div className="text-[11px] text-on-surf-v truncate">↓ {destShort}</div>
      </div>

      {/* Progress (active table) or Exceptions-only summary (history table).
          A real width + resize handle, like every other column — not flex-1 — so
          growing a neighbour can't silently steal its space and clip its content. */}
      {showProgress ? (
        <div style={{ width: colWidths.progress }} className="shrink-0 flex items-center gap-2 min-w-0 overflow-hidden px-[6px]">
          <PhaseChain nodes={chainNodes} compact className="shrink-0" />
          <span className={cn(
            'text-[11px] truncate',
            trip.open_exception_count > 0 ? 'text-warn' :
            trip.status === 'closed'       ? 'text-ok'   :
                                             'text-on-surf-v',
          )}>
            {hint}
          </span>
        </div>
      ) : (
        <div style={{ width: colWidths.progress }} className="shrink-0 flex items-center min-w-0 px-[6px]">
          {trip.open_exception_count > 0 ? (
            <span className="text-[11px] font-[600] text-warn truncate">{hint}</span>
          ) : (
            <span className="text-[11px] font-[600] text-ok">No exceptions</span>
          )}
        </div>
      )}

      {/* Status chip */}
      <div style={{ width: colWidths.status }} className="shrink-0 pl-[6px]">
        <Chip type={statusMeta.chipType} label={statusMeta.label} />
      </div>
    </div>
  )
}
