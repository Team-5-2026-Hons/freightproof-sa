'use client'

import Link from 'next/link'
import { Chip } from '@/components/ui/Chip'
import { fmtExceptionType } from '@/lib/format/exception'
import { ROUTES } from '@/lib/constants/routes'
import { withReturnTo } from '@/lib/navigation/returnTo'
import { EXCEPTION_SEVERITY_META, EXCEPTION_SOURCE_META } from '@shared/lib/constants/status-meta'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { TripException } from '@shared/lib/types/exception'

interface Props { exception: TripException; phaseLabel?: string; returnTo?: string }
export function ExceptionSummary({ exception, phaseLabel, returnTo }: Props) {
  const severity = EXCEPTION_SEVERITY_META[exception.severity]
  const target = ROUTES.exceptionDetail(exception.id)
  return (
    <article className="min-w-0 rounded-lg border border-outline-v/30 bg-surf-low px-4 py-3">
      {phaseLabel && <p className="mb-2 text-xs font-semibold text-on-surf-v">{phaseLabel} · Exception</p>}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-on-surf">{fmtExceptionType(exception.exception_type)}</h3>
        <Chip type={severity.chipType} label={severity.label} />
      </div>
      <p className="mt-2 text-xs text-on-surf-v">{EXCEPTION_SOURCE_META[exception.source].label} · {fmtDateTime(exception.created_at)}</p>
      <p className="mt-2 break-words text-sm text-on-surf">{exception.description}</p>
      <p className="mt-2 text-xs font-semibold text-on-surf-v">
        {exception.review_status === 'needs_review' ? 'Needs review' : exception.review_status === 'reviewed' ? 'Reviewed' : 'Recorded'}
        {exception.review_status === 'reviewed' && exception.reviewed_at && ` · ${fmtDateTime(exception.reviewed_at)}`}
        {exception.review_outcome && ` · ${exception.review_outcome.replaceAll('_', ' ')}`}
      </p>
      <Link className="mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-sec underline underline-offset-4" href={withReturnTo(target, returnTo)}>
        {exception.review_status === 'needs_review' ? 'Review exception' : 'View exception'} →
      </Link>
    </article>
  )
}
