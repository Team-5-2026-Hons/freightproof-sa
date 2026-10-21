import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { IncidentSummary } from '@/lib/types/incident'
import { IncidentTimelineEvent } from './IncidentTimelineEvent'

const incident: IncidentSummary = {
  incident_id: 'incident-1', reference: 'INC1', trip_id: 'trip-1', trip_reference: 'FP-20261020-E30768BA', trip_status: 'cancelled',
  incident_type: 'hijacking', summary: 'Truck stopped at gunpoint near the N3 toll plaza.', status: 'investigating', confidence: 'reported',
  outcome: null, assigned_to_user_id: 'user-1', assigned_to_name: 'Demo Dispatcher', reported_occurred_at: '2026-10-20T09:40:00Z',
  received_at: '2026-10-20T09:55:00Z', trip_stopped_at: null, closed_at: null, created_at: '2026-10-20T09:55:00Z', exception_ids: [],
  exceptions_total: 0, exceptions_reviewed: 0, parcels_total: 7, parcels_unresolved: 2,
}

it('names_the_incident_its_type_status_summary_and_who_has_it', () => {
  render(<IncidentTimelineEvent incident={incident} onOpen={vi.fn()} />)

  expect(screen.getByText('INC1 · Hijacking')).toBeInTheDocument()
  expect(screen.getByText('Investigating')).toBeInTheDocument()
  expect(screen.getByText(incident.summary)).toBeInTheDocument()
  expect(screen.getByLabelText(`Reported ${fmtDateTime('2026-10-20T09:40:00Z')}`).tagName).toBe('TIME')
  expect(screen.getByText(/· Demo Dispatcher/)).toBeInTheDocument()
})

it('says_how_many_parcels_are_still_unresolved_out_of_the_total', () => {
  render(<IncidentTimelineEvent incident={incident} onOpen={vi.fn()} />)

  expect(screen.getByText(/2 of 7 parcels unresolved/)).toBeInTheDocument()
})

it('hides_the_parcels_line_when_the_incident_names_none_and_the_owner_when_unassigned', () => {
  render(<IncidentTimelineEvent incident={{ ...incident, parcels_total: 0, parcels_unresolved: 0, assigned_to_name: null }} onOpen={vi.fn()} />)

  expect(screen.queryByText(/parcel/)).toBeNull()
  expect(screen.queryByText(/Demo Dispatcher/)).toBeNull()
})

it('uses_the_singular_for_a_single_parcel', () => {
  render(<IncidentTimelineEvent incident={{ ...incident, parcels_total: 1, parcels_unresolved: 1 }} onOpen={vi.fn()} />)

  expect(screen.getByText(/1 of 1 parcel unresolved/)).toBeInTheDocument()
})

it('falls_back_to_the_received_time_when_no_occurrence_time_was_reported', () => {
  render(<IncidentTimelineEvent incident={{ ...incident, reported_occurred_at: null }} onOpen={vi.fn()} />)

  expect(screen.getByLabelText(`Reported ${fmtDateTime('2026-10-20T09:55:00Z')}`)).toBeInTheDocument()
})

it('asks_the_page_to_show_the_incident_instead_of_leaving_the_trip', async () => {
  const onOpen = vi.fn()
  render(<IncidentTimelineEvent incident={incident} onOpen={onOpen} />)

  await userEvent.click(screen.getByRole('button', { name: 'Incident INC1 · Hijacking' }))

  expect(onOpen).toHaveBeenCalledExactlyOnceWith('incident-1')
})

it('says_when_this_incident_is_what_stopped_the_trip_as_a_chip_with_the_time', () => {
  const { rerender } = render(<IncidentTimelineEvent incident={incident} onOpen={vi.fn()} />)
  expect(screen.queryByText(/Trip stopped/)).toBeNull()

  rerender(<IncidentTimelineEvent incident={{ ...incident, trip_stopped_at: '2026-10-20T09:56:00Z' }} onOpen={vi.fn()} />)

  expect(screen.getByText(`Trip stopped ${fmtDateTime('2026-10-20T09:56:00Z')}`)).toBeInTheDocument()
})

it('keeps_the_stopped_chip_once_the_incident_is_closed', () => {
  render(<IncidentTimelineEvent incident={{ ...incident, status: 'closed', trip_stopped_at: '2026-10-20T09:56:00Z' }} onOpen={vi.fn()} />)

  expect(screen.getByText(/^Trip stopped /)).toBeInTheDocument()
  expect(screen.getByText('Closed')).toBeInTheDocument()
})

it('drops_a_closed_incident_to_the_quiet_card_and_an_outlined_node', () => {
  const { container } = render(<IncidentTimelineEvent incident={{ ...incident, status: 'closed' }} onOpen={vi.fn()} />)

  const card = screen.getByRole('button')
  expect(card).toHaveClass('border-outline-v/40', 'bg-surf-lowest')
  expect(card.className).not.toMatch(/err/)
  expect(container.querySelector('.bg-err')).toBeNull()
})

it('wears_a_full_perimeter_border_and_never_a_side_stripe', () => {
  render(<IncidentTimelineEvent incident={incident} onOpen={vi.fn()} />)

  const card = screen.getByRole('button')
  expect(card).toHaveClass('border', 'border-err/40', 'bg-err-c/40')
  expect(card.className).not.toMatch(/border-l-|border-r-/)
})
