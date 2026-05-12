import { useRouter } from 'next/navigation'
import { Chip } from '@/components/ui/Chip'
import { TripIdStamp } from './TripIdStamp'
import { HandshakeChain } from './HandshakeChain'
import { TimestampWithIcon } from './TimestampWithIcon'
import { ROUTES } from '@/lib/constants/routes'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import type { TripSummary } from '@shared/lib/types/trip'
import { cn } from '@shared/lib/utils/cn'
import { mockTrips } from '@shared/lib/mocks/trips'

interface ChecklistRowProps {
  trip: TripSummary
  className?: string
}

/**
 * Trip-list row layout used on Active Trips and Trip History.
 * Shows status chip, trip ID, driver, route, compact handshake chain, latest timestamp.
 * Clicking the row navigates to Trip Detail.
 */
export function ChecklistRow({ trip, className }: ChecklistRowProps) {
  const router = useRouter()
  const statusMeta = TRIP_STATUS_META[trip.status]

  const originPrecinct = mockPrecincts.find(p => p.id === trip.origin_precinct_id)
  const destPrecinct = mockPrecincts.find(p => p.id === trip.destination_precinct_id)

  // Get the handshake events from the full trip for the chain visualization
  const fullTrip = mockTrips.find(t => t.id === trip.id)
  const handshakes = fullTrip?.handshakes ?? []

  // Route display — precinct short names
  const originShort = originPrecinct?.name.split('—')[0]?.trim() ?? 'Unknown'
  const destShort = destPrecinct?.name.split('—')[0]?.trim() ?? 'Unknown'

  return (
    <button
      onClick={() => router.push(ROUTES.tripDetail(trip.id))}
      className={cn(
        'w-full flex items-center gap-4 px-5 py-4 text-left',
        'bg-surface-container-lowest rounded-xl shadow-ambient-sm',
        'hover:bg-surface-container-low transition-all duration-200 active:scale-[0.995]',
        'border border-outline-variant/10',
        trip.open_exception_count > 0 && 'border-l-4 border-l-error',
        className,
      )}
    >
      {/* Status chip */}
      <Chip kind={statusMeta.chipKind} className="shrink-0 min-w-[100px] justify-center">
        {statusMeta.label}
      </Chip>

      {/* Trip reference */}
      <div className="shrink-0">
        <TripIdStamp tripReference={trip.trip_reference} />
      </div>

      {/* Driver name */}
      <span className="text-sm font-medium text-surface-on truncate min-w-[120px]">
        {trip.driver.full_name}
      </span>

      {/* Route */}
      <span className="text-xs text-surface-on-variant truncate min-w-[140px] hidden sm:block">
        {originShort} → {destShort}
      </span>

      {/* Compact handshake chain */}
      {handshakes.length > 0 && (
        <div className="hidden lg:block shrink-0">
          <HandshakeChain handshakes={handshakes} compact />
        </div>
      )}

      {/* Latest event timestamp */}
      <div className="ml-auto shrink-0 hidden md:block">
        <TimestampWithIcon timestamp={trip.updated_at} />
      </div>

      {/* Exception count badge */}
      {trip.open_exception_count > 0 && (
        <Chip kind="error" className="shrink-0">
          {trip.open_exception_count}
        </Chip>
      )}
    </button>
  )
}
