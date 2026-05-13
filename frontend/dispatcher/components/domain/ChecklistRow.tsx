'use client'

import { useRouter } from 'next/navigation'
import { Chip } from '@/components/ui/Chip'
import { TripIdStamp } from './TripIdStamp'
import { HandshakeChain } from './HandshakeChain'
import { ROUTES } from '@/lib/constants/routes'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { TripSummary, TripStatus } from '@shared/lib/types/trip'
import { cn } from '@shared/lib/utils/cn'

export interface ColWidths {
  tripId: number
  order:  number
  driver: number
  route:  number
  status: number
}

interface ChecklistRowProps {
  trip: TripSummary
  colWidths: ColWidths
  className?: string
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

export function ChecklistRow({ trip, colWidths, className }: ChecklistRowProps) {
  const router = useRouter()
  const statusMeta = TRIP_STATUS_META[trip.status]

  const originPrecinct = mockPrecincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct   = mockPrecincts.find(p => p.id === trip.destination_precinct_id)
  const fullTrip       = mockTrips.find(t => t.id === trip.id)
  const handshakes     = fullTrip?.handshakes ?? []

  // Truncate to the part before the em-dash for compact display in a table cell
  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? '—'
  const destShort   = destPrecinct?.name.split('—')[0]?.trim() ?? '—'

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
        'w-full flex items-center gap-3 px-6 py-3 text-left',
        'bg-surf-lowest cursor-pointer transition-colors duration-[120ms]',
        'hover:bg-surf-low',
        // Left border accent draws the eye when a trip needs attention
        trip.open_exception_count > 0 && 'border-l-4 border-err',
        className,
      )}
    >
      {/* Trip ID — overflow-hidden prevents monospace text bleeding into adjacent cell */}
      <div style={{ width: colWidths.tripId }} className="shrink-0 overflow-hidden text-[13px] font-[600] text-sec tabular-nums tracking-[0.05em]">
        <TripIdStamp tripReference={trip.trip_reference} />
      </div>

      {/* Order number */}
      <div style={{ width: colWidths.order }} className="shrink-0 text-[11px] text-on-surf-v tabular-nums tracking-[0.03em] truncate">
        {trip.order_number}
      </div>

      {/* Driver + Horse */}
      <div style={{ width: colWidths.driver }} className="shrink-0 min-w-0">
        <div className="text-[14px] font-[600] text-on-surf truncate">{trip.driver.full_name}</div>
        <div className="text-[11px] text-on-surf-v tabular-nums tracking-[0.04em] truncate">
          {trip.horse?.registration ?? '—'}
        </div>
      </div>

      {/* Route */}
      <div style={{ width: colWidths.route }} className="shrink-0 text-[13px] font-[600] text-on-surf truncate">
        {originShort} → {destShort}
      </div>

      {/* Progress — flex-1 fills remaining space between route and status */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        {handshakes.length > 0 && (
          <HandshakeChain handshakes={handshakes} compact />
        )}
        <span className={cn(
          'text-[11px] truncate',
          trip.open_exception_count > 0 ? 'text-warn' :
          trip.status === 'closed'       ? 'text-ok'   :
                                           'text-on-surf-v',
        )}>
          {hint}
        </span>
      </div>

      {/* Status chip */}
      <div style={{ width: colWidths.status }} className="shrink-0">
        <Chip type={statusMeta.chipType} label={statusMeta.label} />
      </div>
    </div>
  )
}
