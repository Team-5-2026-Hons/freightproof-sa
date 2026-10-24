import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { isResolved } from './derive'

/** Where a set of dated events sits against the plan: before the first resolved phase, after a
 *  given phase, or nowhere provable. The same shape serves driver transfers and incidents. */
export interface TimelinePlacement<T> {
  beforeFirst: readonly T[]
  afterPhase: ReadonlyMap<string, readonly T[]>
  unplaced: readonly T[]
}

export type DriverTransferPlacement = TimelinePlacement<CompletedSubstitutionSummary>

/** Puts each event after the last resolved phase that finished at or before it. The phases arrive in
 *  plan order and are never reordered; if the resolved phases' own times do not run forward in that
 *  order, no event is placed, because a position there would be invented. Events are ordered by time,
 *  then `tieBreak`, then `key`, and an event whose `key` repeats is kept once (a polling merge can
 *  deliver the same record twice). */
export function positionTimelineEvents<T>(
  phases: readonly PhaseDescriptor[],
  events: readonly T[],
  at: (event: T) => string,
  key: (event: T) => string,
  tieBreak?: (a: T, b: T) => number,
): TimelinePlacement<T> {
  const beforeFirst: T[] = []
  const afterPhase = new Map<string, T[]>()
  const unplaced: T[] = []
  const boundaries = phases.flatMap((phase, index) => isResolved(phase)
    ? [{ phase, index, at: phase.completed_at === null ? NaN : Date.parse(phase.completed_at) }] : [])
  const consistent = boundaries.length > 0 && boundaries.every((boundary, index) =>
    Number.isFinite(boundary.at) && boundary.index === index && (index === 0 || boundary.at >= boundaries[index - 1].at))
  const seen = new Set<string>()
  const ordered = [...events].sort((a, b) => Date.parse(at(a)) - Date.parse(at(b))
    || (tieBreak?.(a, b) ?? 0) || key(a).localeCompare(key(b)))
  for (const event of ordered) {
    if (seen.has(key(event))) continue
    seen.add(key(event))
    const when = Date.parse(at(event))
    if (!consistent || !Number.isFinite(when)) { unplaced.push(event); continue }
    const preceding = boundaries.filter(boundary => boundary.at <= when).at(-1)
    if (!preceding) { beforeFirst.push(event); continue }
    const slot = afterPhase.get(preceding.phase.phase_event_id) ?? []
    slot.push(event)
    afterPhase.set(preceding.phase.phase_event_id, slot)
  }
  return { beforeFirst, afterPhase, unplaced }
}

export function positionDriverTransfers(phases: readonly PhaseDescriptor[], events: readonly CompletedSubstitutionSummary[]): DriverTransferPlacement {
  return positionTimelineEvents(phases, events, event => event.effective_at, event => event.substitution_id,
    (a, b) => a.sequence_number - b.sequence_number)
}
