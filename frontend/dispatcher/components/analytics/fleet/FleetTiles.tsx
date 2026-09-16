'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { Ic } from '@/components/ui/Ic'
import { Skeleton } from '@/components/ui/Skeleton'
import { NO_DATA } from '@/lib/format/analytics'
import { fmtAge } from '@/lib/format/period'
import type {
  ExpiryBands,
  FleetTiles as FleetTilesData,
  UnusedVehicles,
} from '@shared/lib/types/fleet-analytics'
import { cn } from '@shared/lib/utils/cn'
import { FLEET_COPY } from './copy'

const COPY = FLEET_COPY.tiles
const PERCENT = 100
// Enough registrations to act on without the tile growing taller than its neighbours.
const MAX_LISTED_REGISTRATIONS = 3
const TILE_COUNT = 6

// Deep links into this page's own tabs (spec §3: tiles can open a tab).
const PROBLEMS_TAB_HREF = '/analytics?tab=problems'
const EVIDENCE_TAB_HREF = '/analytics?tab=evidence'

const EXPIRY_BAND_ORDER: readonly (keyof ExpiryBands)[] = [
  'expired', 'within_30_days', 'within_90_days', 'within_180_days', 'no_date',
]

interface FleetTileProps {
  label: string
  value?: string
  sub?: ReactNode
  /** The whole tile becomes one link. Omit when the tile holds its own links. */
  href?: string
  /** Something to act on: warn colour AND an icon with a text label, never colour alone. */
  warn?: boolean
  className?: string
  children?: ReactNode
}

/** One headline number (spec §7.5): label, value in proportional figures, one sub-line. */
export function FleetTile({ label, value, sub, href, warn = false, className, children }: FleetTileProps) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[12px] font-[600] text-on-surf-v">
        {label}
        {warn && (
          <span className="flex items-center text-warn">
            <Ic n="warn" s={14} />
            <span className="sr-only">{COPY.needsAttention}</span>
          </span>
        )}
      </div>
      {value !== undefined && (
        <div className={cn('mt-1 text-[24px] font-semibold leading-tight tracking-[-0.02em]', warn ? 'text-warn' : 'text-on-surf')}>
          {value}
        </div>
      )}
      {sub !== undefined && <div className="mt-1 text-[12px] leading-snug text-on-surf-v">{sub}</div>}
      {children}
    </>
  )
  const shell = cn('block rounded-lg bg-surf-lowest p-4 shadow-level-3', className)

  if (href === undefined) return <div className={shell}>{body}</div>
  return (
    <Link
      href={href}
      className={cn(
        shell,
        'transition-colors hover:bg-surf-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec',
      )}
    >
      {body}
    </Link>
  )
}

function fmtPercent(rate: number | null): string {
  return rate === null ? NO_DATA : `${Math.round(rate * PERCENT)}%`
}

function LicenceTile({ drivers, discs }: { drivers: ExpiryBands; discs: ExpiryBands }) {
  const rows = [
    { label: COPY.licences.drivers, href: '/fleet/drivers', bands: drivers },
    { label: COPY.licences.discs, href: '/fleet/vehicles', bands: discs },
  ]
  return (
    <FleetTile label={COPY.licences.label} warn={drivers.expired + discs.expired > 0} className="col-span-2">
      <table className="mt-2 w-full text-[12px] tabular-nums">
        <caption className="sr-only">{COPY.licences.caption}</caption>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">{COPY.licences.record}</span></th>
            {EXPIRY_BAND_ORDER.map((band) => (
              <th key={band} scope="col" className="px-1 pb-1 text-right font-[600] text-on-surf-v">
                {COPY.licences.bands[band]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="py-0.5 pr-2 text-left font-[600]">
                <Link
                  href={row.href}
                  className="rounded-sm text-sec hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec"
                >
                  {row.label}
                </Link>
              </th>
              {EXPIRY_BAND_ORDER.map((band) => (
                <td
                  key={band}
                  className={cn(
                    'px-1 py-0.5 text-right',
                    band === 'expired' && row.bands.expired > 0 ? 'font-[700] text-err' : 'text-on-surf',
                  )}
                >
                  {row.bands[band]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </FleetTile>
  )
}

function unusedSummary(unused: UnusedVehicles): string {
  const { vehicles } = unused
  if (vehicles.length === 0) return COPY.unused.none(unused.window_days)
  const trucks = vehicles.filter((vehicle) => vehicle.vehicle_type === 'horse').length
  const trailers = vehicles.length - trucks
  const kinds = [
    trucks > 0 ? COPY.unused.trucks(trucks) : null,
    trailers > 0 ? COPY.unused.trailers(trailers) : null,
  ].filter((part): part is string => part !== null)
  const listed = vehicles.slice(0, MAX_LISTED_REGISTRATIONS).map((vehicle) => vehicle.registration)
  const hidden = vehicles.length - listed.length
  const registrations = hidden > 0 ? [...listed, COPY.unused.more(hidden)] : listed
  return `${kinds.join(' · ')} — ${registrations.join(', ')}`
}

interface FleetTilesProps {
  data: FleetTilesData | null
  isLoading: boolean
  error: string | null
  onRetry: () => void
  /** Injectable so ages are testable; defaults to this moment. */
  now?: Date
}

const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7'

/** The six headline tiles. No controls: they always describe the fleet right now (spec D4). */
export function FleetTiles({ data, isLoading, error, onRetry, now }: FleetTilesProps) {
  if (error !== null) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-surf-lowest p-4 text-[13px] text-on-surf shadow-level-3">
        <span>{COPY.loadError} {error}</span>
        <Button size="sm" variant="ghost" onClick={onRetry}>{COPY.retry}</Button>
      </div>
    )
  }

  if (isLoading || data === null) {
    return (
      <div className={GRID} aria-busy="true" aria-label={COPY.ariaLabel}>
        {Array.from({ length: TILE_COUNT }, (_, index) => (
          <Skeleton key={index} className={cn('h-[104px] rounded-lg', index === TILE_COUNT - 2 && 'col-span-2')} />
        ))}
      </div>
    )
  }

  const { critical_waiting: waiting, parcels_complete: parcels, receipts_owed: receipts } = data
  return (
    <section className={GRID} aria-label={COPY.ariaLabel}>
      <FleetTile label={COPY.liveTrips.label} value={String(data.live_trips)} sub={COPY.liveTrips.sub} href="/" />
      <FleetTile
        label={COPY.criticalWaiting.label}
        value={String(waiting.count)}
        sub={
          waiting.oldest_created_at === null
            ? COPY.criticalWaiting.none
            : COPY.criticalWaiting.oldest(fmtAge(waiting.oldest_created_at, now))
        }
        href="/exceptions"
        warn={waiting.count > 0}
      />
      <FleetTile
        label={COPY.parcels.label}
        value={fmtPercent(parcels.complete_rate)}
        sub={COPY.parcels.sub(parcels.complete_trip_count, parcels.loaded_trip_count, parcels.window_days)}
        href={PROBLEMS_TAB_HREF}
      />
      <FleetTile
        label={COPY.receipts.label}
        value={String(receipts.pending_count + receipts.failed_count)}
        sub={receipts.failed_count > 0 ? COPY.receipts.failed(receipts.failed_count) : COPY.receipts.noneFailed}
        href={EVIDENCE_TAB_HREF}
        warn={receipts.failed_count > 0}
      />
      <LicenceTile drivers={data.licence_expiry.drivers} discs={data.licence_expiry.vehicle_discs} />
      <FleetTile
        label={COPY.unused.label}
        value={String(data.unused_vehicles.vehicles.length)}
        sub={unusedSummary(data.unused_vehicles)}
        href="/fleet/vehicles"
      />
    </section>
  )
}
