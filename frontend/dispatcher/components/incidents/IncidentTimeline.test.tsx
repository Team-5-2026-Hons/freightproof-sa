import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { IncidentDetail, IncidentUpdate } from '@/lib/types/incident'
import { IncidentTimeline } from './IncidentTimeline'

let sequence = 0
function update(kind: IncidentUpdate['kind'], overrides: Partial<IncidentUpdate> = {}): IncidentUpdate {
  sequence += 1
  return {
    update_id: `u${sequence}`, sequence, kind, note: null, from_value: null, to_value: null, parcel_id: null,
    exception_id: null, phase_event_id: null, artifact_id: null, external_action: null, action_at: null,
    recorded_by_user_id: 'ana', recorded_by_name: 'Ana', recorded_at: '2026-10-20T10:00:00Z', ...overrides,
  }
}

function incidentWith(updates: IncidentUpdate[]): IncidentDetail {
  const parcels = updates.filter(u => u.parcel_id).map(u => ({ parcel_id: u.parcel_id!, barcode: `BC-${u.parcel_id}` }))
  return { updates, parcels, assigned_to_user_id: null, assigned_to_name: null } as unknown as IncidentDetail
}

const addedParcel = (n: number, recorded_at: string): IncidentUpdate => update('parcel_added', { parcel_id: `p${n}`, recorded_at })

describe('IncidentTimeline', () => {
  it('collapses_a_run_of_parcels_into_one_row_with_the_count_actor_and_time_span', () => {
    const updates = [
      update('status_changed', { to_value: 'investigating' }),
      addedParcel(1, '2026-10-20T10:00:00Z'), addedParcel(2, '2026-10-20T10:05:00Z'), addedParcel(3, '2026-10-20T10:09:00Z'),
    ]

    render(<IncidentTimeline incident={incidentWith(updates)} />)

    const run = screen.getByText('3 parcels named as affected').closest('li')!
    expect(within(run).getByText(/Ana/)).toBeInTheDocument()
    // Earliest and latest stay visible without opening it.
    expect(within(run).getByText(/12:00 SAST.*12:09 SAST/)).toBeInTheDocument()
  })

  it('shows_every_entry_when_the_collapsed_row_is_expanded', async () => {
    const updates = [addedParcel(1, '2026-10-20T10:00:00Z'), addedParcel(2, '2026-10-20T10:05:00Z'), addedParcel(3, '2026-10-20T10:09:00Z')]
    render(<IncidentTimeline incident={incidentWith(updates)} />)
    const summary = screen.getByText('3 parcels named as affected').closest('summary')!
    expect(summary.closest('details')).not.toHaveAttribute('open')

    await userEvent.click(summary)

    const details = summary.closest('details')!
    expect(details).toHaveAttribute('open')
    for (const barcode of ['BC-p1', 'BC-p2', 'BC-p3']) expect(within(details).getByText(barcode)).toBeInTheDocument()
  })

  it('leaves_one_or_two_entries_as_ordinary_rows', () => {
    render(<IncidentTimeline incident={incidentWith([addedParcel(1, '2026-10-20T10:00:00Z'), addedParcel(2, '2026-10-20T10:05:00Z')])} />)

    expect(screen.getAllByText('Parcel named as affected')).toHaveLength(2)
    expect(document.querySelector('details')).toBeNull()
  })
})
