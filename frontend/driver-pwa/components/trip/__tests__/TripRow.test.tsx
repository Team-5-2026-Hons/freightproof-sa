import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TripList, TripRow } from '../TripRow'
import type { DriverTripSummary } from '@/lib/types/driver-trip'

function trip(overrides: Partial<DriverTripSummary> = {}): DriverTripSummary {
  return {
    id: 't1' as DriverTripSummary['id'],
    trip_reference: 'TRP-2026-0038',
    order_number: 'CG-1',
    status: 'created',
    trip_type: 'loaded',
    origin_precinct_id: null,
    destination_precinct_id: null,
    origin_precinct_name: 'Courier Guy JHB — Linbro Park',
    destination_precinct_name: 'Courier Guy CT — Montague Gardens',
    planned_departure_at: '2026-05-09T10:00:00Z',
    actual_departure_at: null,
    planned_arrival_at: '2026-05-10T08:00:00Z',
    actual_arrival_at: null,
    needs_review_count: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

describe('TripRow', () => {
  it('test_whole_row_is_one_control', () => {
    const onSelect = vi.fn()
    render(<TripRow trip={trip()} kind="upcoming" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('test_route_reads_as_one_fact_by_place_name', () => {
    render(<TripRow trip={trip()} kind="upcoming" onSelect={vi.fn()} />)

    expect(screen.getByText('Courier Guy JHB → Courier Guy CT')).toBeInTheDocument()
  })

  it('test_upcoming_row_says_when_and_where_it_departs', () => {
    render(<TripRow trip={trip()} kind="upcoming" onSelect={vi.fn()} />)

    expect(screen.getByText(/^Departs \d{2}:\d{2} · Linbro Park$/)).toBeInTheDocument()
  })

  it('test_says_so_when_no_departure_is_scheduled', () => {
    render(<TripRow trip={trip({ planned_departure_at: null })} kind="upcoming" onSelect={vi.fn()} />)

    expect(screen.getByText('Departure not scheduled')).toBeInTheDocument()
  })

  it('test_past_row_shows_the_outcome_and_duration', () => {
    const done = trip({
      status: 'closed',
      actual_departure_at: '2026-05-09T10:00:00Z',
      actual_arrival_at: '2026-05-09T20:45:00Z',
      planned_arrival_at: '2026-05-09T21:00:00Z',
    })

    render(<TripRow trip={done} kind="past" onSelect={vi.fn()} />)

    expect(screen.getByText('Delivered on time')).toBeInTheDocument()
    expect(screen.getByText('10 h 45')).toBeInTheDocument()
  })

  it('test_falls_back_to_a_label_never_a_raw_uuid', () => {
    render(
      <TripRow
        trip={trip({ origin_precinct_name: null, origin_precinct_id: null })}
        kind="upcoming"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('Unknown → Courier Guy CT')).toBeInTheDocument()
  })
})

describe('TripList', () => {
  it('test_renders_one_item_per_trip_with_inset_rules_between', () => {
    const { container } = render(
      <TripList trips={[trip(), trip({ id: 't2' as DriverTripSummary['id'] })]} kind="upcoming" onSelect={vi.fn()} />,
    )

    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelectorAll('[data-list-rule]')).toHaveLength(1)
  })
})
