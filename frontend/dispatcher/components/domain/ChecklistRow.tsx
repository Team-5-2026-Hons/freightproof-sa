'use client'

import { useRouter } from 'next/navigation'
import { Chip } from '@/components/ui/Chip'
import { TripIdStamp } from './TripIdStamp'
import { PhaseChain } from './PhaseChain'
import { ROUTES } from '@/lib/constants/routes'
import type { TripChecklistItem } from '@shared/lib/types/trip'
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
  trip: TripChecklistItem
  colWidths: ColWidths
  precincts: Precinct[]
  className?: string
  // History table hides the phase progress chain — only whether something needs a
  // dispatcher's attention now still matters (see needs_review_count).
  showProgress?: boolean
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

// Role (origin/destination) is derived, not stored (FP-112). Without a total stop count
// only two cases are provable: stop 0 is the origin, and `confirmation` only fires on the
// last stop (see build_phase_plan). Everything else falls back to a numbered "Stop N".
function stopRoleLabel(trip: TripChecklistItem): string {
  if (trip.current_stop === null) return ''
  if (trip.current_stop === 0) return 'Origin'
  if (trip.current_phase === 'confirmation') return 'Destination'
  return `Stop ${trip.current_stop + 1}`
}

// What the row says the trip is doing. Exceptions win; otherwise the coarse status
// covers terminal states and current_phase covers everything in between.
function progressHint(trip: TripChecklistItem): string {
  if (trip.needs_review_count > 0) {
    return `⚠ ${trip.needs_review_count} exception${trip.needs_review_count > 1 ? 's' : ''}`
  }
  if (trip.status === 'closed')    return '✓ Closed'
  if (trip.status === 'cancelled') return 'Cancelled'
  if (trip.current_phase === null) return 'Pending start'

  const role = stopRoleLabel(trip)
  const stop = role ? ` · ${role}` : ''
  return `${PHASE_NAMES[trip.current_phase]}${stop} · ${trip.phase_completed}/${trip.phase_total}`
}

export function ChecklistRow({ trip, colWidths, precincts, className, showProgress = true }: ChecklistRowProps) {
  const router = useRouter()

  // The chip names the phase (e.g. `Unloading`, `⚠ Unloading` when held), reading the
  // cache since this list has no plan to derive from.
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
        trip.needs_review_count > 0 && 'border-l-4 border-err',
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

      {/* Real width, not flex-1, like every other column, so a neighbour can't clip it. */}
      {showProgress ? (
        <div style={{ width: colWidths.progress }} className="shrink-0 flex items-center gap-2 min-w-0 overflow-hidden px-[6px]">
          <PhaseChain nodes={chainNodes} compact className="shrink-0" />
          <span className={cn(
            'text-[11px] truncate',
            trip.needs_review_count > 0 ? 'text-warn' :
            trip.status === 'closed'       ? 'text-ok'   :
                                             'text-on-surf-v',
          )}>
            {hint}
          </span>
        </div>
      ) : (
        <div style={{ width: colWidths.progress }} className="shrink-0 flex items-center min-w-0 px-[6px]">
          {trip.needs_review_count > 0 ? (
            <span className="text-[11px] font-[600] text-warn truncate">{hint}</span>
          ) : (
            // NOT "No exceptions" — needs_review_count is zero once reviewed exceptions
            // are resolved, even though the record still holds them. See docs/known-issues.md issue 11.
            <span className="text-[11px] font-[600] text-ok">None need review</span>
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
