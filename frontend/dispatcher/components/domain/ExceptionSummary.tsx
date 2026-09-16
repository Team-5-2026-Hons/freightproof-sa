'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Chip } from '@/components/ui/Chip'
import { Ic } from '@/components/ui/Ic'
import { fmtExceptionType } from '@/lib/format/exception'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { TripException } from '@shared/lib/types/exception'

interface Props {
  exception: TripException; phaseLabel?: string; returnTo?: string
  /** The map button / supporting-evidence disclosure for this exception, when it has
   *  either. Rendered inside this same card behind a divider, so a GPS-backed exception
   *  reads as one bordered block instead of a card with unrelated controls floating
   *  below it. */
  footer?: ReactNode
  /** When provided, replaces the "View exception"/"Review exception" link (a full page
   *  navigation) with an "Open in exceptions panel" trigger. The trip timeline passes
   *  this: review and full detail both belong to the exceptions panel, not a second,
   *  competing route out of the timeline card. TripExceptionsPanel never passes it — it
   *  IS that panel, so its own cards keep the real link through to the exception's page. */
  onOpenPanel?: () => void
  /** Card surface tone. 'low' (default) reads correctly against a 'lowest'-toned
   *  container — the trip timeline's scroller and the overlay Modal both are. The
   *  docked exceptions panel is itself 'low' (DetailPanel's `<aside>`), so a card
   *  rendered there passes 'lowest' instead — the same adjustment ManifestContent
   *  already makes for its own blocks in that exact panel — or the card is
   *  indistinguishable from its own background but for a faint border. */
  tone?: 'low' | 'lowest'
}
export function ExceptionSummary({ exception, phaseLabel, returnTo, footer, onOpenPanel, tone = 'low' }: Props) {
  const severity = EXCEPTION_SEVERITY_META[exception.severity]
  const target = ROUTES.exceptionDetail(exception.id)
  return (
    <article className={`min-w-0 rounded-lg border border-outline-v/30 px-4 py-3 ${tone === 'lowest' ? 'bg-surf-lowest' : 'bg-surf-low'}`}>
      {phaseLabel && <p className="mb-2 text-xs font-semibold text-on-surf-v">{phaseLabel} · Exception</p>}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-on-surf">{fmtExceptionType(exception.exception_type)}</h3>
          <Chip type={severity.chipType} label={severity.label} />
        </div>
        {/* Matches PhaseTimelineItem's own <time> exactly (size, weight, colour, clock
            icon): an exception is a timestamped event same as a phase is, so it earns
            the same visual weight the timeline already gives its own timestamps —
            instead of the small, muted, source-sharing line this used to be. */}
        <time dateTime={exception.created_at} className="flex shrink-0 items-center gap-[4px] text-[12px] font-[700] tabular-nums text-sec">
          <Ic n="clock" s={11} className="text-sec" />{fmtDateTime(exception.created_at)}
        </time>
      </div>
      <p className="mt-1 text-xs text-on-surf-v">{EXCEPTION_SOURCE_META[exception.source].label}</p>
      <p className="mt-2 break-words text-sm text-on-surf">{exception.description}</p>
      <p className="mt-2 text-xs font-semibold text-on-surf-v">
        {exception.review_status === 'needs_review' ? 'Needs review' : exception.review_status === 'reviewed' ? 'Reviewed' : 'Recorded'}
        {exception.review_status === 'reviewed' && exception.reviewed_at && ` · ${fmtDateTime(exception.reviewed_at)}`}
        {exception.review_outcome && ` · ${exception.review_outcome.replaceAll('_', ' ')}`}
      </p>
      {onOpenPanel
        ? <button type="button" onClick={onOpenPanel} className="mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-sec underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec">
            Open in exceptions panel
          </button>
        : <Link className="mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-sec underline underline-offset-4" href={withReturnTo(target, returnTo)}>
            {exception.review_status === 'needs_review' ? 'Review exception' : 'View exception'} →
          </Link>}
      {footer && <div className="mt-3 border-t border-outline-v/20 pt-3">{footer}</div>}
    </article>
  )
}
