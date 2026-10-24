'use client'

import Link from 'next/link'
import { Chip } from '@/components/ui/Chip'
import { SkeletonBar } from '@/components/ui/Skeleton'
import type { TableColumn } from '@/components/ui/Table'
import { TripIdStamp } from '@/components/domain/TripIdStamp'
import { ROUTES } from '@/lib/constants/routes'
import { countLabel } from '@/lib/format/count'
import { manifestClient, manifestKey, manifestLabel } from '@/lib/format/manifest'
import { routeShortName } from '@/lib/trips/route-name'
import { tripChipMeta } from '@/lib/phase/derive'
import { fmtSastDateParts } from '@shared/lib/utils/datetime'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripAttention, TripChecklistItem } from '@shared/lib/types/trip'

// Desktop-first. Base widths come from measuring the widest realistic content inside the compact
// table's 12px cell padding: the trip ID (about 200px of text and copy icon) is the one cell that
// cannot wrap. They are also the floor, since columns only scale up from here to fill a wider
// container. The route column is the widest after it so a name like "Cape Town Depot (Epping)"
// fits on one line at desktop sizes instead of stacking the row four lines tall.
const DATE_WIDTH_PX = 104
const TRIP_WIDTH_PX = 226
const DRIVER_WIDTH_PX = 118
const ROUTE_WIDTH_PX = 170
const STATUS_WIDTH_PX = 112
const MANIFEST_WIDTH_PX = 110
const EXCEPTIONS_WIDTH_PX = 130
// The active list's note also names criticals and claims ("3 exceptions · 1 critical · 2 unclaimed").
const ATTENTION_WIDTH_PX = 160
const CORE_WIDTH_PX = DATE_WIDTH_PX + TRIP_WIDTH_PX + DRIVER_WIDTH_PX + ROUTE_WIDTH_PX + STATUS_WIDTH_PX

// A narrower container folds the least critical columns into neighbouring cells rather than
// scrolling: on History the exceptions note first (under the status chip), then the manifest (under
// the trip ID). The dashboard never folds its exceptions (see buildTripColumns). Each threshold is
// exactly the width at which the columns before it still fit.
const exceptionsHideBelow = (exceptionsWidth: number): number => CORE_WIDTH_PX + exceptionsWidth
const manifestHideBelow = (exceptionsWidth: number): number => exceptionsHideBelow(exceptionsWidth) + MANIFEST_WIDTH_PX

export interface TripDateColumn<T> {
  label: string
  /** Which of the row's timestamps this column shows (created vs closed). */
  pick: (row: T) => string
}

interface TripColumnOptions<T extends TripChecklistItem> {
  precincts: readonly Precinct[]
  date: TripDateColumn<T>
  /** Dashboard: where the trip is in its plan, under the status chip, and room for the claim split
   *  in the exceptions note. History has neither: its trips are finished. */
  showProgress: boolean
  /** Header buttons for the owner to handle. Off for server-paginated lists, where sorting one
   *  page would present a partial ordering as the whole. Needs `onSort` on the Table too. */
  sortable?: boolean
  /** Where a row opens. A filtered list passes one carrying its URL as returnTo, so the trip page's
   *  own Back button returns to the list as it was left. */
  hrefFor?: (tripId: string) => string
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

// Only critical is named: warnings are the routine case, and naming them on every row would bury
// the one word that changes what a dispatcher does next. Claimed exceptions still count in the
// total because they still need review; the suffix says whether anyone has taken them on.
function attentionDetail(total: number, attention: TripAttention): string {
  const critical = attention.critical > 0 ? ` · ${attention.critical} critical` : ''
  const unclaimed = total - attention.claimed
  const owner = unclaimed === 0 ? ' · all claimed' : unclaimed === total ? ' · unclaimed' : ` · ${unclaimed} unclaimed`
  return `${critical}${owner}`
}

/** What still needs a dispatcher's review, or null when nothing does. Rows from the active list
 *  carry the severity and claim split, so they also say how bad and whether anyone has it. */
export function exceptionsLabel(trip: TripChecklistItem): string | null {
  const total = trip.needs_review_count
  if (total === 0) return null
  const count = `⚠ ${countLabel(total, 'exception')}`
  return trip.attention ? `${count}${attentionDetail(total, trip.attention)}` : count
}

/** Where the trip is in its plan, shown under the status chip: "Origin · 1/7". The chip already
 *  names the phase and covers finished and not-started trips, so those get nothing here. */
export function planPosition(trip: TripChecklistItem): string | null {
  if (trip.status === 'closed' || trip.status === 'cancelled' || trip.current_phase === null) return null
  const role = stopRoleLabel(trip)
  return `${role ? `${role} · ` : ''}${trip.phase_completed}/${trip.phase_total}`
}

function ExceptionsNote({ trip }: { trip: TripChecklistItem }) {
  const label = exceptionsLabel(trip)
  // A critical reads in the error colour, matching the severity the attention order ranks first.
  if (label) return <span className={`text-[11px] font-[600] ${trip.attention && trip.attention.critical > 0 ? 'text-err' : 'text-warn'}`}>{label}</span>
  // NOT "No exceptions": needs_review_count is zero once reviewed exceptions are resolved,
  // even though the record still holds them.
  return <span className="text-[11px] font-[600] text-ok">None need review</span>
}

// Red inset edge, as the old row's left border did: a trip that needs attention draws the eye.
// A <tr> cannot take a border in a border-separate table, so the first cell carries it.
const NEEDS_REVIEW_EDGE = 'bg-surf-lowest hover:bg-surf-low [&>td:first-child]:shadow-[inset_4px_0_0_0_theme(colors.err.DEFAULT)]'

/** Row styling for trips that still need a dispatcher's review; undefined keeps the default. */
export function tripRowClassName(trip: TripChecklistItem): string | undefined {
  return trip.needs_review_count > 0 ? NEEDS_REVIEW_EDGE : undefined
}

/** One definition drives the header and every cell for both trip lists, so History and the
 *  Dashboard cannot drift apart. Built per render because route names depend on the loaded
 *  precincts. */
export function buildTripColumns<T extends TripChecklistItem>({ precincts, date, showProgress, sortable = false, hrefFor = ROUTES.tripDetail }: TripColumnOptions<T>): TableColumn<T>[] {
  const exceptionsWidth = showProgress ? ATTENTION_WIDTH_PX : EXCEPTIONS_WIDTH_PX
  const columns: TableColumn<T>[] = [
    {
      id: 'date', sortable, label: date.label, width: DATE_WIDTH_PX, minWidth: 100,
      skeleton: <><SkeletonBar className="h-3.5 w-20" /><SkeletonBar className="mt-2 h-2.5 w-14" /></>,
      render: trip => {
        const parts = fmtSastDateParts(date.pick(trip))
        if (!parts) return <span className="text-on-surf-v">—</span>
        return <div className="tabular-nums">
          <p className="text-[11px] text-on-surf">{parts.day}</p>
          <p className="mt-0.5 text-[11px] text-on-surf-v">{parts.time}</p>
        </div>
      },
    },
    {
      id: 'trip', sortable, label: 'Trip ID', width: TRIP_WIDTH_PX, minWidth: TRIP_WIDTH_PX,
      skeleton: <SkeletonBar className="h-3.5 w-40" />,
      render: (trip, { hidden }) => <>
        {/* Above the row link's overlay, so copying the ID does not also open the trip. */}
        <div className="relative z-10 inline-block">{/* Important: TripIdStamp sets its own text colour, and the Active-trips look is the secondary one. */}<TripIdStamp tripReference={trip.trip_reference} className="text-[13px] !text-sec" /></div>
        {hidden.has('manifest') && <p className="mt-1 break-words text-[11px] text-on-surf-v">{manifestLabel(trip.pp_manifest, trip.trip_type ?? null)}</p>}
      </>,
    },
    {
      id: 'manifest', sortable, label: 'Manifest', width: MANIFEST_WIDTH_PX, minWidth: 100, hideBelow: manifestHideBelow(exceptionsWidth),
      skeleton: <SkeletonBar className="h-3 w-24" />,
      // Key first, client beneath, both wrapped: the key is what tells two manifests apart, so a
      // narrow column must never push it out of sight, and a tooltip would be swallowed by the
      // row-wide link overlay.
      render: trip => {
        const client = manifestClient(trip.pp_manifest)
        return <>
          <p className="break-words text-[11px] tracking-[0.03em] text-on-surf">{manifestKey(trip.pp_manifest, trip.trip_type ?? null)}</p>
          {client && <p className="mt-0.5 break-words text-[11px] text-on-surf-v">{client}</p>}
        </>
      },
    },
    {
      id: 'driver', sortable, label: 'Driver / horse', width: DRIVER_WIDTH_PX, minWidth: 110,
      skeleton: <><SkeletonBar className="h-3.5 w-28" /><SkeletonBar className="mt-2 h-2.5 w-20" /></>,
      render: trip => <>
        {/* The only link in the row; its ::after covers the whole <tr> so the row is one
            target without nesting interactive elements. Named by driver and trip because
            several rows can share a driver. */}
        <Link href={hrefFor(trip.id)} aria-label={`${trip.driver.full_name} · ${trip.trip_reference}`}
          className="text-[13px] font-semibold text-on-surf after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-sec">
          {trip.driver.full_name}
        </Link>
        <p className="mt-0.5 text-[11px] tabular-nums tracking-[0.04em] text-on-surf-v">{trip.horse?.registration ?? '—'}</p>
      </>,
    },
    {
      id: 'route', sortable, label: 'Route', width: ROUTE_WIDTH_PX, minWidth: 110,
      skeleton: <><SkeletonBar className="h-3.5 w-24" /><SkeletonBar className="mt-2 h-2.5 w-20" /></>,
      // Origin over destination so neither is cut off in a narrow column.
      render: trip => <>
        <p className="text-[13px] font-semibold text-on-surf">{routeShortName(precincts, trip.origin_precinct_id)}</p>
        <p className="mt-0.5 text-[11px] text-on-surf-v">↓ {routeShortName(precincts, trip.destination_precinct_id)}</p>
      </>,
    },
    {
      id: 'exceptions', sortable, label: 'Exceptions', width: exceptionsWidth, minWidth: 120,
      // Never folded on the dashboard; see the reorder below.
      hideBelow: showProgress ? undefined : exceptionsHideBelow(exceptionsWidth),
      skeleton: <SkeletonBar className="h-3 w-28" />,
      render: trip => <ExceptionsNote trip={trip} />,
    },
    {
      id: 'status', sortable, label: 'Status', width: STATUS_WIDTH_PX, minWidth: 110,
      skeleton: <SkeletonBar className="h-6 w-20 rounded-md" />,
      render: (trip, { hidden }) => {
        const meta = tripChipMeta(trip.status, trip.current_phase)
        const position = showProgress ? planPosition(trip) : null
        return <>
          <Chip type={meta.chipType} label={meta.label} />
          {position && <p className="mt-1 text-[11px] tabular-nums text-on-surf-v">{position}</p>}
          {/* The exceptions column's note moves here while that column is hidden. */}
          {hidden.has('exceptions') && <div className="mt-2"><ExceptionsNote trip={trip} /></div>}
        </>
      },
    },
  ]
  if (!showProgress) return columns
  // The dashboard is a monitoring screen, so what needs attention sits right after the trip it
  // belongs to and never folds: when a narrow window makes the table scroll sideways, the trip and
  // its exceptions are still in the first screen. History keeps the record order.
  const exceptions = columns.filter(column => column.id === 'exceptions')
  const others = columns.filter(column => column.id !== 'exceptions')
  const afterTrip = others.findIndex(column => column.id === 'trip') + 1
  return [...others.slice(0, afterTrip), ...exceptions, ...others.slice(afterTrip)]
}
