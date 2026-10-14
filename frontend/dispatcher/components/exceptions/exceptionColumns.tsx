'use client'

import Link from 'next/link'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { SkeletonBar } from '@/components/ui/Skeleton'
import type { TableColumn } from '@/components/ui/Table'
import {
  RAISED_TIME_UNAVAILABLE, fmtClaimedFor, fmtExceptionPhaseStop, fmtExceptionRaisedParts, fmtExceptionRoute, fmtExceptionType,
} from '@/lib/format/exception'
import { reviewState } from '@/lib/format/review-state'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import type { TripExceptionListItem } from '@shared/lib/types/exception'

// Container width below which the crew column folds into the trip cell: under this the five
// columns no longer fit side by side without a horizontal scrollbar. Equal to the five base
// widths below (250 + 190 + 170 + 120 + 170), so the table never scrolls just to show a column.
const CREW_HIDE_BELOW_PX = 900
const INITIALS_MAX = 2

export const EXCEPTION_TABLE_ID = 'exceptions'

interface ColumnOptions {
  meId: string | null
  now: Date
  hrefFor: (id: string) => string
  onOpen: (id: string) => void
}

const vehiclesOf = (item: TripExceptionListItem): string =>
  [item.horse_registration, ...item.trailer_registrations].filter((v): v is string => !!v).join(' + ')

function initialsOf(name: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return words.slice(0, INITIALS_MAX).map(word => word[0].toUpperCase()).join('') || '?'
}

function ClaimBadge({ item, meId, now }: { item: TripExceptionListItem; meId: string | null; now: Date }) {
  const state = reviewState(item, meId)
  const since = fmtClaimedFor(item.claimed_at, now)
  if (state.kind === 'unreviewed') return <p className="text-on-surf-v">Unclaimed</p>
  if (state.kind !== 'claimed_by_me' && state.kind !== 'claimed_by_other') return <p className="break-words text-on-surf-v">{state.label}</p>
  const mine = state.kind === 'claimed_by_me'
  return (
    <div className="flex items-start gap-2">
      <span aria-hidden className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${mine ? 'bg-primary text-primary-on' : 'bg-sec-c text-sec-onc'}`}>
        {initialsOf(item.claimed_by_name)}
      </span>
      <div className="min-w-0">
        <p className="break-words font-semibold text-on-surf">{state.label}</p>
        {since && <p className="text-xs text-on-surf-v">{since}</p>}
      </div>
    </div>
  )
}

/** One definition drives header and cells, so a column can never be added to one and forgotten
 *  in the other. Built per render: the cells depend on who is looking and what time it is. */
export function buildExceptionColumns({ meId, now, hrefFor, onOpen }: ColumnOptions): TableColumn<TripExceptionListItem>[] {
  return [
    {
      id: 'incident', label: 'Incident', width: 250, minWidth: 200, sortable: true,
      skeleton: <>
        <div className="flex items-center gap-2"><SkeletonBar className="h-5 w-16 rounded-md" /><SkeletonBar className="h-3.5 w-32" /></div>
        <SkeletonBar className="mt-3 h-3 w-full" />
        <SkeletonBar className="mt-2 h-3 w-4/5" />
        <SkeletonBar className="mt-2 h-2.5 w-1/3" />
      </>,
      render: item => {
        const severity = EXCEPTION_SEVERITY_META[item.severity]
        const title = fmtExceptionType(item.exception_type)
        const phaseStop = fmtExceptionPhaseStop(item.phase_label, item.stop_label)
        return <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip type={severity.chipType} label={severity.label} />
            {/* The only link in the row; its ::after covers the whole <tr> so the row is one target
                without nesting interactive elements inside each other. */}
            <Link href={hrefFor(item.id)} data-exception-id={item.id} aria-label={`${title} · ${item.trip_reference}`} onClick={() => onOpen(item.id)}
              className="font-semibold text-on-surf after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-sec">{title}</Link>
          </div>
          <p className="mt-1.5 line-clamp-2 break-words leading-relaxed text-on-surf-v">{item.description}</p>
          {phaseStop && <p className="mt-1 text-xs text-on-surf-v">{phaseStop}</p>}
        </>
      },
    },
    {
      id: 'trip', label: 'Trip & route', width: 190, minWidth: 140, sortable: true,
      skeleton: <>
        <SkeletonBar className="h-3 w-32" />
        <SkeletonBar className="mt-2.5 h-3 w-24" />
        <SkeletonBar className="mt-1.5 h-3 w-28" />
      </>,
      render: (item, { hidden }) => <>
        <p className="text-xs font-semibold tabular-nums text-on-surf">{item.trip_reference}</p>
        <p className="mt-1 leading-snug text-on-surf-v" title={fmtExceptionRoute(item.origin_name, item.destination_name)}>{fmtExceptionRoute(item.origin_name, item.destination_name, true)}</p>
        {/* The crew column's content moves here while that column is hidden, so a narrow screen
            loses a column, not information. */}
        {hidden.has('crew') && <p className="mt-1 text-xs text-on-surf-v">{[item.driver_name ?? 'Driver not recorded', vehiclesOf(item)].filter(Boolean).join(' · ')}</p>}
      </>,
    },
    {
      id: 'crew', label: 'Driver & vehicles', width: 170, minWidth: 140, hideBelow: CREW_HIDE_BELOW_PX, sortable: true,
      skeleton: <>
        <SkeletonBar className="h-3.5 w-28" />
        <SkeletonBar className="mt-2 h-2.5 w-32" />
      </>,
      render: item => <>
        <p className="text-on-surf">{item.driver_name ?? 'Driver not recorded'}</p>
        <p className="mt-1 text-xs text-on-surf-v">{vehiclesOf(item) || 'No vehicles recorded'}</p>
      </>,
    },
    {
      id: 'raised', label: 'Raised', width: 120, minWidth: 100, sortable: true,
      skeleton: <>
        <SkeletonBar className="h-3.5 w-20" />
        <SkeletonBar className="mt-2 h-2.5 w-14" />
      </>,
      render: item => {
        const parts = fmtExceptionRaisedParts(item.created_at)
        if (!parts) return <p className="text-on-surf-v">{RAISED_TIME_UNAVAILABLE}</p>
        return <div className="tabular-nums">
          <p className="text-on-surf">{parts.day}</p>
          <p className="mt-1 text-xs text-on-surf-v">{parts.time}</p>
        </div>
      },
    },
    {
      id: 'status', label: 'Status', width: 170, minWidth: 140, sortable: true,
      skeleton: <>
        <div className="flex items-center gap-2"><SkeletonBar className="h-6 w-6 shrink-0" /><SkeletonBar className="h-3 w-24" /></div>
        <SkeletonBar className="mt-3 h-3 w-14" />
      </>,
      render: item => {
        const state = reviewState(item, meId)
        const action = item.review_status === 'reviewed' ? 'View review'
          : item.review_status === 'recorded' ? 'View record'
            : state.kind === 'claimed_by_other' ? 'Take over' : 'Review'
        return <>
          <ClaimBadge item={item} meId={meId} now={now} />
          <span className="mt-2 inline-flex items-center gap-1 font-semibold text-sec">{action}<Ic n="chev" s={14} /></span>
        </>
      },
    },
  ]
}
