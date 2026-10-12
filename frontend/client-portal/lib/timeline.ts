// One chronological list of everything that happened on the trip, so an adjuster reads
// the custody chain, the checkpoints and the incidents as a single story.
import { humanise } from './format'
import type {
  AuditPackManifest,
  CheckpointRecord,
  EvidenceTier,
  ExceptionRecord,
  PhaseRecord,
  PositionFix,
} from './types'

interface Base {
  id: string
  at: string | null
  title: string
  tier: EvidenceTier
  pending: boolean
  positions: PositionFix[]
}

export type TimelineItem =
  | (Base & { kind: 'phase'; record: PhaseRecord })
  | (Base & { kind: 'checkpoint'; record: CheckpointRecord })
  | (Base & { kind: 'exception'; record: ExceptionRecord; critical: boolean })

function present(fixes: (PositionFix | null)[]): PositionFix[] {
  return fixes.filter((f): f is PositionFix => f !== null)
}

export function exceptionLabel(index: number, exception: ExceptionRecord): string {
  return `E${index + 1} · ${humanise(exception.exception_type)}`
}

export function buildTimeline(manifest: AuditPackManifest): TimelineItem[] {
  const timed: TimelineItem[] = [
    ...manifest.phases.map((p): TimelineItem => ({
      kind: 'phase', id: p.phase_event_id, at: p.completed_at, record: p,
      title: `P${p.sequence_number} · ${humanise(p.phase_type)}${p.precinct_name ? ` · ${p.precinct_name}` : ''}`,
      tier: p.tier, pending: p.completed_at === null,
      positions: present([p.driver_phone, p.vehicle_tracker, ...p.trailer_fixes]),
    })),
    ...manifest.checkpoints.map((c): TimelineItem => ({
      kind: 'checkpoint', id: c.checkpoint_id, at: c.recorded_at, record: c,
      title: `Checkpoint · ${humanise(c.checkpoint_type)}`, tier: c.tier, pending: false,
      positions: present([c.driver_phone, c.vehicle_tracker]),
    })),
    ...manifest.exceptions.map((e, i): TimelineItem => ({
      kind: 'exception', id: e.exception_id, at: e.raised_at, record: e, title: exceptionLabel(i, e),
      tier: e.tier, pending: false, critical: e.severity === 'critical', positions: present([e.position]),
    })),
  ]

  // Completed events by time; pending phases after them in plan order — they have no
  // time because they never happened, and that absence is itself the finding.
  const done = timed.filter((item) => !item.pending).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  const pending = timed
    .filter((item): item is Extract<TimelineItem, { kind: 'phase' }> => item.pending && item.kind === 'phase')
    .sort((a, b) => a.record.sequence_number - b.record.sequence_number)
  return [...done, ...pending]
}
