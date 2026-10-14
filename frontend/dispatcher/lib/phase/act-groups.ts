// Several uploads for one role read as one row group, not as a stack of near-identical rows
// (the dispatcher cares that there are three photos, and which one the phase submitted).
// Pure so vitest can prove it.

import type { EvidenceRole } from '@shared/lib/types/evidence'
import type { EvidenceAct, PhaseAct } from './acts'
import { evidenceTimes } from './act-wording'

export interface EvidenceGroup {
  kind: 'evidence_group'
  key: string
  role: EvidenceRole
  /** The submitted copy first, so the one row that stays visible is the one that counts. */
  acts: EvidenceAct[]
}

export type ActItem = EvidenceGroup | Exclude<PhaseAct, EvidenceAct>

/** Only an entirely untimed submitted group belongs with the completion. A late upload
 * or a known-time retake keeps its own position and must not inherit submission status. */
export function isUntimedSubmittedEvidence(item: ActItem): boolean {
  return item.kind === 'evidence_group' && item.acts.every(act => act.state === 'submitted' && evidenceTimes(act).every(time => time.at === null))
}

const SUBMITTED_FIRST = (a: EvidenceAct, b: EvidenceAct): number =>
  Number(b.state === 'submitted') - Number(a.state === 'submitted')

/** Groups evidence acts by role at the position of the first act of that role; every other
 *  act passes through in place. */
export function groupActs(acts: readonly PhaseAct[]): ActItem[] {
  const byRole = new Map<EvidenceRole, EvidenceAct[]>()
  for (const act of acts) {
    if (act.kind === 'evidence') byRole.set(act.role, [...(byRole.get(act.role) ?? []), act])
  }
  const placed = new Set<EvidenceRole>()
  const items: ActItem[] = []
  for (const act of acts) {
    if (act.kind !== 'evidence') {
      items.push(act)
      continue
    }
    if (placed.has(act.role)) continue
    placed.add(act.role)
    // Array.prototype.sort is stable, so equal states keep their time order.
    items.push({ kind: 'evidence_group', key: `${act.key}:group`, role: act.role, acts: [...(byRole.get(act.role) ?? [])].sort(SUBMITTED_FIRST) })
  }
  return items
}
