import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { IncidentSummary } from '@/lib/types/incident'
import { TripIncidentsSection } from './TripIncidentsSection'

const INCIDENT: IncidentSummary = {
  incident_id: 'inc-1', reference: 'INC1', trip_id: 't1', trip_reference: 'FP-1', trip_status: 'closed',
  incident_type: 'parcel_shortage', summary: '3 short', status: 'closed', confidence: 'reported', outcome: 'inconclusive',
  assigned_to_user_id: null, assigned_to_name: null, reported_occurred_at: null, received_at: '2026-10-20T10:00:00Z',
  trip_stopped_at: null, closed_at: '2026-10-20T12:00:00Z', created_at: '2026-10-20T10:00:00Z', exception_ids: [],
  exceptions_total: 0, exceptions_reviewed: 0, parcels_total: 0, parcels_unresolved: 0,
}

describe('TripIncidentsSection', () => {
  it('links each incident back to this trip, closed ones included', () => {
    // Arrange / Act
    render(<TripIncidentsSection incidents={[INCIDENT]} isLoading={false} returnTo="/trips/t1?panel=information" onReport={vi.fn()} />)

    // Assert
    const link = screen.getByRole('link', { name: 'View incident INC1' })
    expect(link).toHaveAttribute('href', `/incidents/inc-1?returnTo=${encodeURIComponent('/trips/t1?panel=information')}`)
    expect(screen.getByText('Closed')).toBeInTheDocument()
  })

  it('says which incident stopped the trip, and the row can be landed on and outlined', () => {
    render(<TripIncidentsSection incidents={[{ ...INCIDENT, trip_stopped_at: '2026-10-20T10:05:00Z' }]} isLoading={false} returnTo="/trips/t1" onReport={vi.fn()} highlightedId="inc-1" />)

    expect(screen.getByText('Trip stopped')).toBeInTheDocument()
    const row = document.querySelector('[data-incident-row="inc-1"]')
    expect(row).toHaveClass('ring-2')
    expect(row?.className).not.toMatch(/border-l-/)
  })

  it('draws each incident on the same white bordered card the driver handovers use', () => {
    render(<TripIncidentsSection incidents={[INCIDENT]} isLoading={false} returnTo="/trips/t1" onReport={vi.fn()} />)

    expect(document.querySelector('[data-incident-row="inc-1"]')).toHaveClass('rounded-lg', 'border', 'border-outline-v/40', 'bg-surf-lowest')
  })

  it('shows what the incident is about, so the row can be told apart without opening it', () => {
    render(<TripIncidentsSection incidents={[INCIDENT]} isLoading={false} returnTo="/trips/t1" onReport={vi.fn()} />)

    expect(screen.getByText('3 short')).toBeInTheDocument()
  })

  it('puts the link top right beside the title and the chips on their own row below', () => {
    render(<TripIncidentsSection incidents={[{ ...INCIDENT, trip_stopped_at: '2026-10-20T10:05:00Z' }]} isLoading={false} returnTo="/trips/t1" onReport={vi.fn()} />)

    const row = document.querySelector('[data-incident-row="inc-1"]')!
    expect(row).toHaveClass('flex', 'justify-between')
    const link = screen.getByRole('link', { name: 'View incident INC1' })
    expect(link.parentElement).toBe(row)
    const chips = screen.getByText('Closed').parentElement!
    expect(chips).toContainElement(screen.getByText('Trip stopped'))
    expect(chips).not.toContainElement(screen.getByText(/INC1 ·/))
  })

  it('shows skeleton rows while loading, not a sentence', () => {
    // Arrange / Act
    render(<TripIncidentsSection incidents={[]} isLoading returnTo="/trips/t1" onReport={vi.fn()} />)

    // Assert
    expect(screen.getByRole('status', { name: 'Loading incidents' })).toBeInTheDocument()
  })

  it('puts the Report incident button at the top of the body and carries no heading of its own', () => {
    // Arrange / Act
    const onReport = vi.fn()
    render(<TripIncidentsSection incidents={[]} isLoading={false} returnTo="/trips/t1" onReport={onReport} />)

    // Assert
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Report incident' })).toBeInTheDocument()
    expect(screen.getByText('No incidents on this trip.')).toBeInTheDocument()
  })

  it.each([
    [{ parcels_total: 7, parcels_unresolved: 2 }, '2 of 7 parcels unresolved'],
    [{ parcels_total: 1, parcels_unresolved: 1 }, '1 of 1 parcel unresolved'],
    [{ parcels_total: 4, parcels_unresolved: 0 }, '0 of 4 parcels unresolved'],
  ])('says what the unresolved count is out of (%o)', (parcels, expected) => {
    render(<TripIncidentsSection incidents={[{ ...INCIDENT, ...parcels }]} isLoading={false} returnTo="/trips/t1" onReport={vi.fn()} />)

    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('hides the parcels line when the incident cites no parcels', () => {
    render(<TripIncidentsSection incidents={[{ ...INCIDENT, parcels_total: 0, parcels_unresolved: 0 }]} isLoading={false} returnTo="/trips/t1" onReport={vi.fn()} />)

    expect(screen.queryByText(/unresolved/)).not.toBeInTheDocument()
  })
})
