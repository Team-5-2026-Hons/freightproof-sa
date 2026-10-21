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
    const link = screen.getByRole('link', { name: /INC1/ })
    expect(link).toHaveAttribute('href', `/incidents/inc-1?returnTo=${encodeURIComponent('/trips/t1?panel=information')}`)
    expect(screen.getByText('Closed')).toBeInTheDocument()
  })

  it('shows skeleton rows while loading, not a sentence', () => {
    // Arrange / Act
    render(<TripIncidentsSection incidents={[]} isLoading returnTo="/trips/t1" onReport={vi.fn()} />)

    // Assert
    expect(screen.getByRole('status', { name: 'Loading incidents' })).toBeInTheDocument()
  })
})
