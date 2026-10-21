import type { CompletedSubstitutionSummary } from '@shared/lib/types/driver-substitution'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import { isResolved } from './derive'

export interface DriverTransferPlacement {
  beforeFirst: readonly CompletedSubstitutionSummary[]
  afterPhase: ReadonlyMap<string, readonly CompletedSubstitutionSummary[]>
  unplaced: readonly CompletedSubstitutionSummary[]
}

export function positionDriverTransfers(phases: readonly PhaseDescriptor[], events: readonly CompletedSubstitutionSummary[]): DriverTransferPlacement {
  const beforeFirst: CompletedSubstitutionSummary[] = []
  const afterPhase = new Map<string, CompletedSubstitutionSummary[]>()
  const unplaced: CompletedSubstitutionSummary[] = []
  // The parent supplies plan order. Never reorder the phases or manufacture device-time custody.
  const boundaries = phases.flatMap((phase, index) => isResolved(phase)
    ? [{ phase, index, at: phase.completed_at === null ? NaN : Date.parse(phase.completed_at) }] : [])
  const consistent = boundaries.length > 0 && boundaries.every((boundary, index) =>
    Number.isFinite(boundary.at) && boundary.index === index && (index === 0 || boundary.at >= boundaries[index - 1].at))
  const seen = new Set<string>()
  const ordered = [...events].sort((a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at)
    || a.sequence_number - b.sequence_number || a.substitution_id.localeCompare(b.substitution_id))
  for (const event of ordered) {
    if (seen.has(event.substitution_id)) continue
    seen.add(event.substitution_id)
    const at = Date.parse(event.effective_at)
    if (!consistent || !Number.isFinite(at)) { unplaced.push(event); continue }
    const preceding = boundaries.filter(boundary => boundary.at <= at).at(-1)
    if (!preceding) { beforeFirst.push(event); continue }
    const slot = afterPhase.get(preceding.phase.phase_event_id) ?? []
    slot.push(event)
    afterPhase.set(preceding.phase.phase_event_id, slot)
  }
  return { beforeFirst, afterPhase, unplaced }
}
