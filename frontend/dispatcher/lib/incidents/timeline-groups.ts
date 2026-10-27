import type { IncidentUpdate, IncidentUpdateKind } from '@/lib/types/incident'

export const MIN_RUN_LENGTH = 3

const FOLDABLE_KINDS: ReadonlySet<IncidentUpdateKind> = new Set<IncidentUpdateKind>(['parcel_added', 'exception_linked'])

export type TimelineRow =
  | { type: 'single'; update: IncidentUpdate }
  | { type: 'run'; kind: IncidentUpdateKind; updates: IncidentUpdate[] }

function canFold(update: IncidentUpdate): boolean {
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
