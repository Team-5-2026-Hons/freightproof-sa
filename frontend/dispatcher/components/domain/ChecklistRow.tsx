'use client'

import { useRouter } from 'next/navigation'
import { Chip } from '@/components/ui/Chip'
import { TripIdStamp } from './TripIdStamp'
import { HandshakeChain } from './HandshakeChain'
import { ROUTES } from '@/lib/constants/routes'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { TripSummary, TripStatus } from '@shared/lib/types/trip'
import type { HandshakeEvent, HandshakeNumber, HandshakeStatus } from '@shared/lib/types/handshake'
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
  // History table hides the handshake progress chain — trips there are already
  // complete or cancelled, so only whether exceptions occurred still matters.
  showProgress?: boolean
}

const STATUS_HINT: Record<TripStatus, string> = {
  created:         'Pending start',
  origin_gate_in:  'H1: Gate In',
  loading:         'H2: Loading',
  origin_gate_out: 'H3: Gate Out',
  in_transit:      'In Transit',
  dest_gate_in:    'H4: Dest Gate',
  unloading:       'H5: Unloading',
  closed:          '✓ Closed',
  cancelled:       'Cancelled',
  exception_hold:  '⚠ Exception',
}

// How many handshakes (0-indexed) are completed for each trip status.
// H0 (trip creation) is always completed once the trip exists.
const COMPLETED_THROUGH: Record<TripStatus, number> = {
  created:         0,
  origin_gate_in:  0,
  loading:         1,
  origin_gate_out: 2,
  in_transit:      3,
  dest_gate_in:    3,
  unloading:       4,
  closed:          5,
  exception_hold:  0,
  cancelled:       0,
}

// Which handshake sequence number is currently in-progress (null = none).
const IN_PROGRESS_HS: Record<TripStatus, number | null> = {
  created:         null,
  origin_gate_in:  1,
  loading:         2,
  origin_gate_out: 3,
  in_transit:      null,
  dest_gate_in:    4,
  unloading:       5,
  closed:          null,
  exception_hold:  null,
  cancelled:       null,
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

// Synthesise the six handshake nodes needed by HandshakeChain from TripStatus alone.
// TripSummary doesn't carry full HandshakeEvent objects, so we build minimal stubs.
function chainNodesFromStatus(status: TripStatus): HandshakeEvent[] {
  const completedThrough = COMPLETED_THROUGH[status]
  const inProgressHs = IN_PROGRESS_HS[status]

  return Array.from({ length: 6 }, (_, i) => {
    let hsStatus: HandshakeStatus
    if (i <= completedThrough) {
      hsStatus = 'completed'
    } else if (i === inProgressHs) {
      hsStatus = 'in_progress'
    } else if (status === 'exception_hold' && i === inProgressHs) {
      hsStatus = 'exception'
    } else {
      hsStatus = 'pending'
    }
    // Cast: HandshakeChain only reads id, status, sequence_number from each node
    return {
      id: `chain-${i}`,
      sequence_number: i as HandshakeNumber,
      status: hsStatus,
    } as HandshakeEvent
  })
}

export function ChecklistRow({ trip, colWidths, precincts, className, showProgress = true }: ChecklistRowProps) {
  const router = useRouter()
  const statusMeta = TRIP_STATUS_META[trip.status]

  const originPrecinct = precincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct   = precincts.find(p => p.id === trip.destination_precinct_id)

  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? '—'
  const destShort   = destPrecinct?.name.split('—')[0]?.trim() ?? '—'

  const chainNodes = chainNodesFromStatus(trip.status)

  // Exception count takes priority over status hint so dispatchers see it immediately
  const hint = trip.open_exception_count > 0
    ? `⚠ ${trip.open_exception_count} exception${trip.open_exception_count > 1 ? 's' : ''}`
    : STATUS_HINT[trip.status]

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
          <HandshakeChain handshakes={chainNodes} compact className="shrink-0" />
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
