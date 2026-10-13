import { describe, expect, it } from 'vitest'
import type { EvidenceAct, PhaseAct } from './acts'
import { groupActs } from './act-groups'

function evidence(id: string, role: EvidenceAct['role'], state: EvidenceAct['state'] = 'uploaded'): EvidenceAct {
  return {
    kind: 'evidence', key: `p:evidence:${id}`, role, artifactId: id, provenance: 'driver', state,
    metadataAvailable: true, takenAt: '2026-01-01T10:00:00Z', receivedAt: '2026-01-01T10:00:00Z',
    receivedAfterCancellation: false,
  }
}

describe('groupActs', () => {
  it('puts several uploads for one role in one group at the position of the first', () => {
    const acts: PhaseAct[] = [
      evidence('a', 'seal_photo'),
      { kind: 'exception', key: 'p:exception:x', exceptionId: 'x', at: '2026-01-01T10:30:00Z' },
      evidence('b', 'seal_photo'),
    ]

    const items = groupActs(acts)

    expect(items.map(item => item.kind)).toEqual(['evidence_group', 'exception'])
    const group = items[0]
    if (group?.kind !== 'evidence_group') throw new Error('expected a group')
    expect(group.role).toBe('seal_photo')
    expect(group.acts.map(act => act.artifactId)).toEqual(['a', 'b'])
  })

  it('keeps different roles in separate groups', () => {
    const items = groupActs([evidence('a', 'seal_photo'), evidence('b', 'waybill_photo')])

    expect(items).toHaveLength(2)
  })

  it('leads a group with the copy the phase submitted, so the first row is the one that counts', () => {
    const items = groupActs([
      evidence('late', 'pod_photo', 'not_submitted'),
      evidence('kept', 'pod_photo', 'submitted'),
    ])

    const group = items[0]
    if (group?.kind !== 'evidence_group') throw new Error('expected a group')
    expect(group.acts.map(act => act.artifactId)).toEqual(['kept', 'late'])
  })

  it('passes every non-evidence act through untouched', () => {
    const completion: PhaseAct = { kind: 'absent', key: 'p:absent:seal_photo', role: 'seal_photo' }

    expect(groupActs([completion])).toEqual([completion])
  })
})
