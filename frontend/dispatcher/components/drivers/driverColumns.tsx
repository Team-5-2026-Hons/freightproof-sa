'use client'

import Link from 'next/link'
import { Chip } from '@/components/ui/Chip'
import { SkeletonBar } from '@/components/ui/Skeleton'
import type { TableColumn } from '@/components/ui/Table'
import { ROUTES } from '@/lib/constants/routes'
import { fmtCalendarDate, fmtSastDateParts } from '@shared/lib/utils/datetime'
import type { Driver } from '@shared/lib/types/driver'

export const DRIVER_TABLE_ID = 'drivers'

const MS_PER_DAY = 86_400_000
// Licence warning thresholds: red covers "expires within a month, or already has".
const EXPIRY_RED_DAYS = 30
const EXPIRY_AMBER_DAYS = 90
const ID_VISIBLE_DIGITS = 4

// Desktop-first. Base widths were measured inside the compact table's 12px cell padding, and
// are also the floor: columns only scale up from here to fill a wider container.
const NAME_WIDTH_PX = 190
const ID_WIDTH_PX = 110
const PHONE_WIDTH_PX = 130
const EXPIRY_WIDTH_PX = 120
const STATUS_WIDTH_PX = 100
const ADDED_WIDTH_PX = 120
// Below this container width the "added" column folds under the driver's name instead of
// scrolling; it is exactly the width the other five columns need.
const ADDED_HIDE_BELOW_PX = NAME_WIDTH_PX + ID_WIDTH_PX + PHONE_WIDTH_PX + EXPIRY_WIDTH_PX + STATUS_WIDTH_PX + ADDED_WIDTH_PX

/** Whole days until a date-only string: negative once it has passed, null when there is none. */
export function daysUntil(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - now.getTime()) / MS_PER_DAY)
}

export function ExpiryCell({ value, now }: { value: string | null; now: Date }) {
  if (!value) return <span className="text-sm text-surface-on-variant">—</span>
  const days = daysUntil(value, now) as number
  const label = fmtCalendarDate(value) ?? value
  // Colour-code: red <=30 days (including expired), amber <=90, plain otherwise.
  const colour = days <= EXPIRY_RED_DAYS ? 'text-red-500' : days <= EXPIRY_AMBER_DAYS ? 'text-amber-500' : 'text-surface-on'
  return <span className={`text-sm tabular-nums ${colour}`}>{label}</span>
}

interface DriverColumnOptions {
  /** Drives the licence colours; the page re-evaluates it so a tab left open overnight updates. */
  now: Date
}

/** One definition drives the header and every cell. Built per render because the licence
 *  colours depend on the current time. */
export function buildDriverColumns({ now }: DriverColumnOptions): TableColumn<Driver>[] {
  return [
    {
      id: 'name', label: 'Name', width: NAME_WIDTH_PX, minWidth: 150, sortable: true,
      skeleton: <SkeletonBar className="h-3.5 w-28" />,
      render: (driver, { hidden }) => {
        const added = fmtSastDateParts(driver.created_at)
        return <>
          {/* The only link in the row; its ::after covers the whole <tr> so the row is one target
              without nesting interactive elements. */}
          <Link href={ROUTES.fleetDriverDetail(driver.id)}
            className="font-bold text-surface-on after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-sec">
            {driver.full_name}
          </Link>
          {/* The added column's content moves here while that column is hidden. */}
          {hidden.has('added') && added && <p className="mt-0.5 text-[11px] text-on-surf-v">Added {added.day}</p>}
        </>
      },
    },
    {
      id: 'id_number', label: 'ID number', width: ID_WIDTH_PX, minWidth: 90,
      skeleton: <SkeletonBar className="h-3 w-16" />,
      // Masked for POPIA: only the last four digits are ever shown in a list.
      render: driver => <span className="font-mono text-xs tracking-wider text-surface-on-variant">···· {driver.id_number.slice(-ID_VISIBLE_DIGITS)}</span>,
    },
    {
      id: 'phone', label: 'Phone', width: PHONE_WIDTH_PX, minWidth: 110,
      skeleton: <SkeletonBar className="h-3 w-24" />,
      render: driver => <span className="text-sm tabular-nums text-surface-on">{driver.phone_number}</span>,
    },
    {
      id: 'expiry', label: 'Licence expiry', width: EXPIRY_WIDTH_PX, minWidth: 100, sortable: true,
      skeleton: <SkeletonBar className="h-3 w-20" />,
      render: driver => <ExpiryCell value={driver.license_expiry} now={now} />,
    },
    {
      id: 'status', label: 'Status', width: STATUS_WIDTH_PX, minWidth: 90, sortable: true,
      skeleton: <SkeletonBar className="h-6 w-16 rounded-md" />,
      render: driver => <Chip type={driver.is_active ? 'complete' : 'pending'} label={driver.is_active ? 'Active' : 'Inactive'} />,
    },
    {
      id: 'added', label: 'Added', width: ADDED_WIDTH_PX, minWidth: 100, hideBelow: ADDED_HIDE_BELOW_PX, sortable: true,
      skeleton: <><SkeletonBar className="h-3.5 w-20" /><SkeletonBar className="mt-2 h-2.5 w-14" /></>,
      render: driver => {
        const parts = fmtSastDateParts(driver.created_at)
        if (!parts) return <span className="text-on-surf-v">—</span>
        return <div className="tabular-nums">
          <p className="text-[11px] text-on-surf">{parts.day}</p>
          <p className="mt-0.5 text-[11px] text-on-surf-v">{parts.time}</p>
        </div>
      },
    },
  ]
}
