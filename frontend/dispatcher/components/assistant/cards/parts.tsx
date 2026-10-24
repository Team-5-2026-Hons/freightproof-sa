'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { Spinner } from '@/components/ui/Spinner'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'
import { fmtDateTime, fmtSastDateParts } from '@shared/lib/utils/datetime'
import type { NeedsReview, RecordRef } from '@shared/lib/types/assistant'
import { usePendingHref, type NavigateTo } from '../navigation'

/** Where a record's own page is. */
export function hrefFor(record: Pick<RecordRef, 'kind' | 'id'>): string {
  switch (record.kind) {
    case 'driver': return ROUTES.fleetDriverDetail(record.id)
    case 'vehicle': return ROUTES.fleetVehicleDetail(record.id)
    case 'trip': return ROUTES.tripDetail(record.id)
    case 'precinct': return ROUTES.precinctDetail(record.id)
  }
}

export interface CardProps {
  /** Called when a link in the card is followed, so the pop-up can get out of the way (spec D6). */
  onNavigate: NavigateTo
}

/** A link to a record's page, compact enough for a card row. */
export function CardLink({ href, onNavigate, children }: { href: string; onNavigate: NavigateTo; children: ReactNode }) {
  const opening = usePendingHref() === href
  return (
    <Link
      href={href}
      onClick={() => onNavigate(href)}
      aria-busy={opening || undefined}
      className="font-[700] text-sec underline underline-offset-2 hover:text-on-surf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec"
    >
      {children}
      {opening && <Spinner size="sm" className="ml-1 inline-block align-middle" />}
    </Link>
  )
}

export function CardShell({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex w-full flex-col gap-2 rounded-lg border border-outline-v/30 bg-surf-lowest p-3 text-[12px] leading-snug text-on-surf">
      <h3 className="text-[12px] font-[800] text-on-surf">{title}</h3>
      {children}
    </section>
  )
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-on-surf-v', className)}>{children}</span>
}

/** "2 critical · 1 warning to review", or nothing when there is nothing waiting. */
export function ReviewCounts({ counts, empty }: { counts: NeedsReview; empty?: string }) {
  const parts = (['critical', 'warning', 'info'] as const)
    .filter((severity) => counts[severity] > 0)
    // "47 warnings", "1 warning"; critical and info read as adjectives ("2 critical"), so they stay as they are.
    .map((severity) => `${counts[severity]} ${severity === 'warning' && counts[severity] !== 1 ? 'warnings' : severity}`)
  if (parts.length === 0) return empty ? <Muted>{empty}</Muted> : null
  return (
    <span className={cn('font-[600]', counts.critical > 0 ? 'text-err' : 'text-warn')}>
      {parts.join(' · ')} to review
    </span>
  )
}

const MIDNIGHT = '00:00'
const ONE_MS = 1

/** A window as people say it: "21 Oct 2026" for one whole day, "24 Oct 2026 – 25 Oct 2026" for whole days, else
 *  "21 Oct, 18:36 SAST to 28 Oct, 18:36 SAST". Windows end at the next midnight (half-open), so the last day shown
 *  is the one just before the end. */
export function fmtWindow(startIso: string, endIso: string): string {
  const start = fmtSastDateParts(startIso)
  const end = fmtSastDateParts(endIso)
  if (start && end && start.time.startsWith(MIDNIGHT) && end.time.startsWith(MIDNIGHT)) {
    const lastDay = fmtSastDateParts(new Date(Date.parse(endIso) - ONE_MS).toISOString())
    if (lastDay) return lastDay.day === start.day ? start.day : `${start.day} – ${lastDay.day}`
  }
  return `${fmtDateTime(startIso)} to ${fmtDateTime(endIso)}`
}
