import { describe, expect, it } from 'vitest'
import type { IncidentUpdate } from '@/lib/types/incident'
import { groupUpdates } from './timeline-groups'

let sequence = 0
function update(kind: IncidentUpdate['kind'], overrides: Partial<IncidentUpdate> = {}): IncidentUpdate {
  sequence += 1
  return {
    update_id: `u${sequence}`, sequence, kind, note: null, from_value: null, to_value: null, parcel_id: null,
    exception_id: null, phase_event_id: null, artifact_id: null, external_action: null, action_at: null,
    recorded_by_user_id: 'ana', recorded_by_name: 'Ana', recorded_at: '2026-10-20T10:00:00Z', ...overrides,
  }
}
const parcels = (count: number, overrides: Partial<IncidentUpdate> = {}): IncidentUpdate[] =>
  Array.from({ length: count }, () => update('parcel_added', overrides))

const shape = (rows: ReturnType<typeof groupUpdates>): string[] =>
  rows.map(row => row.type === 'run' ? `${row.updates.length}x${row.kind}` : row.update.kind)

describe('groupUpdates', () => {
  it('folds_three_or_more_consecutive_same_kind_same_actor_entries_into_one_run', () => {
    const rows = groupUpdates([update('opened'), ...parcels(48), update('status_changed')])

    expect(shape(rows)).toEqual(['opened', '48xparcel_added', 'status_changed'])
  })

  it('keeps_every_entry_of_a_run_in_ledger_order', () => {
    const run = parcels(3)

    const [row] = groupUpdates(run)

    expect(row).toMatchObject({ type: 'run' })
    expect(row!.type === 'run' && row!.updates.map(u => u.update_id)).toEqual(run.map(u => u.update_id))
  })

  it('leaves_runs_of_one_or_two_alone', () => {
    expect(shape(groupUpdates([...parcels(2), update('status_changed'), ...parcels(1)]))).toEqual(
      ['parcel_added', 'parcel_added', 'status_changed', 'parcel_added'],
    )
  })

  it('ends_a_run_when_the_actor_changes', () => {
    const rows = groupUpdates([...parcels(3), ...parcels(3, { recorded_by_user_id: 'ben', recorded_by_name: 'Ben' })])

    expect(shape(rows)).toEqual(['3xparcel_added', '3xparcel_added'])
  })

  it('ends_a_run_when_the_kind_changes_and_never_merges_across_a_different_kind', () => {
    const rows = groupUpdates([...parcels(3), update('exception_linked'), ...parcels(3)])

    expect(shape(rows)).toEqual(['3xparcel_added', 'exception_linked', '3xparcel_added'])
  })

  it('never_folds_kinds_that_carry_their_own_content', () => {
    const notes = Array.from({ length: 4 }, () => update('note', { note: 'Spoke to the driver.' }))

    expect(shape(groupUpdates(notes))).toEqual(['note', 'note', 'note', 'note'])
  })

  it('never_folds_an_entry_that_has_a_note_of_its_own', () => {
    const rows = groupUpdates([...parcels(3), update('parcel_added', { note: 'Seal was cut.' }), ...parcels(3)])

    expect(shape(rows)).toEqual(['3xparcel_added', 'parcel_added', '3xparcel_added'])
  })

  it('returns_nothing_for_an_empty_ledger', () => {
    expect(groupUpdates([])).toEqual([])
  })
})
