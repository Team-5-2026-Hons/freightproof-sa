'use client'

import { Chip } from '@/components/ui/Chip'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import { fmtExceptionType } from '@/lib/format/exception'
import { legDepartureAt } from '@/lib/phase/derive'
import { EXCEPTION_SEVERITY_META } from '@shared/lib/constants/status-meta'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ExceptionSeverity, TripException } from '@shared/lib/types/exception'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

interface Props {
  phase: PhaseDescriptor
  // Needed to date THIS leg from its own preceding departure — legDepartureAt reads
  // the highest-sequence departure strictly before `phase`, so a cross-dock trip's
  // second leg is never dated from the first leg's exit. See lib/phase/derive.ts.
  allPhases: readonly PhaseDescriptor[]
  originName: string
  destinationName: string
  // Already scoped to THIS phase's own phase_event_id and sorted by the caller
  // (chronological by captured/event time when available, else recorded time, id as
  // the tie-break) — this component only renders what it is given, never re-filters
  // trip.exceptions itself, so it cannot accidentally mix in another leg's record.
  exceptions: readonly TripException[]
  onOpenExceptions: () => void
  /** Lookup used to keep the visible marker timestamp identical to timeline ordering. */
  artifactsById?: ReadonlyMap<string, EvidenceArtifactWithUrl>
}

type LegState = 'pending' | 'active' | 'complete'

/** Which of the three states this leg is honestly in.
 *
 * Deliberately NOT `phase.completed_at !== null` alone: override_phase stamps
 * completed_at on an OVERRIDDEN row too (D4 — dated even though nothing happened),
 * so treating that as 'complete' would print the override timestamp as if a truck
 * had actually arrived. An overridden leg instead falls through to 'active' (if it
 * ever departed) or 'pending' (if it never did) — neither of which invents an
 * arrival, which is the one thing this component must never do. */
function legStateFor(phase: PhaseDescriptor, departedAt: string | null): LegState {
  if (phase.status !== 'overridden' && phase.completed_at !== null) return 'complete'
  return departedAt === null ? 'pending' : 'active'
}

// Most severe first: a dispatcher scanning down the timeline reads "1 critical"
// before "2 warnings", never the reverse.
const SEVERITY_ORDER: readonly ExceptionSeverity[] = ['critical', 'warning', 'info']

interface SeverityCount {
  severity: ExceptionSeverity
  count: number
}

/** De-duplicated by id — a defensive floor under both the marker rows and the
 *  severity counts below, so a caller that ever hands this component the same
 *  exception twice (an overlapping filter, a re-render race) cannot print it twice or
 *  inflate its count. The caller is expected to already de-duplicate; this just makes
 *  that an invariant of the component rather than a hope. */
function uniqueById(exceptions: readonly TripException[]): TripException[] {
  const seen = new Set<string>()
  const result: TripException[] = []
  for (const exception of exceptions) {
    if (seen.has(exception.id)) continue
    seen.add(exception.id)
    result.push(exception)
  }
  return result
}

function severityCounts(exceptions: readonly TripException[]): SeverityCount[] {
  return SEVERITY_ORDER
    .map((severity): SeverityCount => ({ severity, count: exceptions.filter(e => e.severity === severity).length }))
    .filter(entry => entry.count > 0)
}

function exceptionEventTime(exception: TripException, artifactsById?: ReadonlyMap<string, EvidenceArtifactWithUrl>): string {
  const artifact = exception.supporting_artifact_id
    ? artifactsById?.get(exception.supporting_artifact_id)
    : undefined
  return artifact?.captured_at ?? exception.created_at
}

/**
 * The always-visible summary of one transit leg: departure -> arrival (or the honest
 * "not yet" state) plus compact exception markers, rendered as `PhaseTimelineItem`'s
 * `persistentContent` so it never depends on the card being expanded.
 *
 * Per the plan's binding spec text: "In-transit exception markers show timestamp,
 * label and severity, with a link to the panel, rather than duplicate full cards." One
 * marker row per exception (in the chronological order the caller already sorted them
 * into), plus a severity-count summary and a single link to open the full panel — no
 * description text, no artifacts, no full cards here.
 */
export function TransitJourneySummary({
  phase, allPhases, originName, destinationName, exceptions, onOpenExceptions, artifactsById,
}: Props) {
  const departedAt = legDepartureAt(allPhases, phase)
  const state = legStateFor(phase, departedAt)
  const scopedExceptions = uniqueById(exceptions)
  const counts = severityCounts(scopedExceptions)

  const statusLabel = state === 'pending'
    ? 'Awaiting departure'
    : state === 'active'
      ? `En route to ${destinationName}`
      : `Arrived ${destinationName}`

  return (
    <div className="mt-3 flex flex-col gap-[8px] border-t border-outline-v/20 pt-3">
      <div className="flex flex-wrap items-center gap-[6px] text-[12px] font-[600] text-on-surf">
        <span className="truncate text-on-surf-v">{originName}</span>
        <span aria-hidden className="shrink-0 text-on-surf-v">→</span>
        <span className="truncate">{statusLabel}</span>
        {state === 'complete' && phase.completed_at && (
          <time dateTime={phase.completed_at} className="shrink-0 text-[11px] font-[700] tabular-nums text-sec">
            {fmtDateTime(phase.completed_at)}
          </time>
        )}
      </div>

      {scopedExceptions.length > 0 && (
        <div className="flex flex-col gap-[4px]">
          {scopedExceptions.map(exception => (
            <div key={exception.id} data-testid="transit-exception-marker" className="flex min-w-0 items-center gap-[8px] text-[11px]">
              <time dateTime={exceptionEventTime(exception, artifactsById)} className="shrink-0 font-[600] tabular-nums text-sec">
                {fmtDateTime(exceptionEventTime(exception, artifactsById))}
              </time>
              <span className="min-w-0 truncate text-on-surf-v">{fmtExceptionType(exception.exception_type)}</span>
              <Chip type={EXCEPTION_SEVERITY_META[exception.severity].chipType} label={EXCEPTION_SEVERITY_META[exception.severity].label} />
            </div>
          ))}
        </div>
      )}

      {counts.length > 0 && (
        <button
          type="button"
          onClick={onOpenExceptions}
          aria-label={`View exceptions for this leg (${scopedExceptions.length})`}
          className="flex w-fit shrink-0 flex-wrap items-center gap-[6px] rounded-md text-[11px] font-[700] text-sec underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec"
        >
          {counts.map(({ severity, count }) => (
            <Chip key={severity} type={EXCEPTION_SEVERITY_META[severity].chipType} label={`${count} ${severity}${count === 1 ? ' exception' : ' exceptions'}`} />
          ))}
          View exceptions
        </button>
      )}
    </div>
  )
}
