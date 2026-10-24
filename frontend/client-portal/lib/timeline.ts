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
  // True when a field the anchor receipt commits to no longer matches it. The tier is already
  // downgraded; this lets the detail panel say why the Anchored badge is missing.
  anchorWarning: boolean
}

export type TimelineItem =
  | (Base & { kind: 'phase'; record: PhaseRecord })
  | (Base & { kind: 'checkpoint'; record: CheckpointRecord })
  | (Base & { kind: 'exception'; record: ExceptionRecord; critical: boolean })

/**
 * An ISO instant as epoch milliseconds, for ordering and comparing times.
 *
 * Never compare timestamp strings: "…10:00:00Z" sorts after "…10:00:00.25Z" ('Z' > '.'), and
 * "12:00:00+02:00" sorts after "11:00:00Z" although it is an hour earlier. An unparsable or
 * missing time becomes Infinity so it sorts last instead of poisoning the comparison with NaN.
 */
export function instantMs(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

export function compareInstants(a: string | null | undefined, b: string | null | undefined): number {
  const left = instantMs(a)
  const right = instantMs(b)
  // Not `left - right`: Infinity - Infinity is NaN, which makes sort order undefined.
  return left < right ? -1 : left > right ? 1 : 0
}

function present(fixes: (PositionFix | null)[]): PositionFix[] {
  return fixes.filter((f): f is PositionFix => f !== null)
}

export function exceptionLabel(index: number, exception: ExceptionRecord): string {
  return `E${index + 1} · ${humanise(exception.exception_type)}`
}

export function buildTimeline(manifest: AuditPackManifest): TimelineItem[] {
  const timed: TimelineItem[] = [
    ...manifest.phases.map((p): TimelineItem => {
      // A field that no longer matches its receipt means the stored record changed after
      // anchoring, so the Anchored tier the server computed must not be shown for it.
      const anchorWarning = p.anchored_fields.some((f) => f.matches_anchor === false)
      return {
        kind: 'phase', id: p.phase_event_id, at: p.completed_at, record: p,
        title: `P${p.sequence_number} · ${humanise(p.phase_type)}${p.precinct_name ? ` · ${p.precinct_name}` : ''}`,
        tier: anchorWarning ? 'recorded' : p.tier, pending: p.completed_at === null, anchorWarning,
        positions: present([p.driver_phone, p.vehicle_tracker, ...p.trailer_fixes]),
      }
    }),
    ...manifest.checkpoints.map((c): TimelineItem => ({
      kind: 'checkpoint', id: c.checkpoint_id, at: c.recorded_at, record: c,
      title: `Checkpoint · ${humanise(c.checkpoint_type)}`, tier: c.tier, pending: false, anchorWarning: false,
      positions: present([c.driver_phone, c.vehicle_tracker]),
    })),
    ...manifest.exceptions.map((e, i): TimelineItem => ({
      kind: 'exception', id: e.exception_id, at: e.raised_at, record: e, title: exceptionLabel(i, e),
      tier: e.tier, pending: false, anchorWarning: false, critical: e.severity === 'critical',
      positions: present([e.position]),
    })),
  ]

  // Completed events by time; pending phases after them in plan order — they have no
  // time because they never happened, and that absence is itself the finding.
  const done = timed.filter((item) => !item.pending).sort((a, b) => compareInstants(a.at, b.at))
  const pending = timed
    .filter((item): item is Extract<TimelineItem, { kind: 'phase' }> => item.pending && item.kind === 'phase')
    .sort((a, b) => a.record.sequence_number - b.record.sequence_number)
  return [...done, ...pending]
}
