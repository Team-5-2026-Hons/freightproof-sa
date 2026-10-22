import type { IncidentUpdate, IncidentUpdateKind } from '@/lib/types/incident'

/** Fewer than this is just a short list; folding one or two entries hides more than it saves. */
export const MIN_RUN_LENGTH = 3

// Only entries that are bulk bookkeeping: naming 48 parcels or grouping a batch of exceptions is 48
// near-identical lines that bury the status changes, notes and findings around them. Anything that
// carries its own content (a note, a finding, a document, a close) stays a row of its own, since
// folding it would hide exactly the substantive updates this exists to surface.
const FOLDABLE_KINDS: ReadonlySet<IncidentUpdateKind> = new Set<IncidentUpdateKind>(['parcel_added', 'exception_linked'])

export type TimelineRow =
  | { type: 'single'; update: IncidentUpdate }
  | { type: 'run'; kind: IncidentUpdateKind; updates: IncidentUpdate[] }

function canFold(update: IncidentUpdate): boolean {
  // A note is the dispatcher's own words, so an entry carrying one is never folded away.
  return FOLDABLE_KINDS.has(update.kind) && update.note === null
}

function continuesRun(run: IncidentUpdate[], next: IncidentUpdate): boolean {
  const first = run[0]!
  return canFold(next) && next.kind === first.kind && next.recorded_by_user_id === first.recorded_by_user_id
}

/**
 * Groups the ledger, which must already be in order, into rows. A run of at least MIN_RUN_LENGTH
 * consecutive entries of the same foldable kind by the same person becomes one row; a run is never
 * extended across a different kind or person, so the order of events is never rearranged.
 */
export function groupUpdates(updates: readonly IncidentUpdate[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  let run: IncidentUpdate[] = []

  const flush = (): void => {
    if (run.length >= MIN_RUN_LENGTH) rows.push({ type: 'run', kind: run[0]!.kind, updates: run })
    else rows.push(...run.map((update): TimelineRow => ({ type: 'single', update })))
    run = []
  }

  for (const update of updates) {
    if (run.length > 0 && continuesRun(run, update)) { run.push(update); continue }
    flush()
    if (canFold(update)) run = [update]
    else rows.push({ type: 'single', update })
  }
  flush()
  return rows
}
