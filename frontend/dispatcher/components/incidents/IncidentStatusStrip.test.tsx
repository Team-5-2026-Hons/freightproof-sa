import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { IncidentSummary } from '@/lib/types/incident'
import { IncidentStatusStrip } from './IncidentStatusStrip'

const BASE: IncidentSummary = {
  incident_id: 'i1', reference: 'INC1', trip_id: 't1', trip_reference: 'FP-1', trip_status: 'closed',
  incident_type: 'parcel_shortage', summary: '3 short', status: 'investigating', confidence: 'reported', outcome: null,
  assigned_to_user_id: null, assigned_to_name: null, reported_occurred_at: null, received_at: '2026-10-20T10:00:00Z',
  trip_stopped_at: null, closed_at: null, created_at: '2026-10-20T10:00:00Z', exception_ids: ['e1', 'e2', 'e3'],
  exceptions_total: 3, exceptions_reviewed: 2, parcels_total: 3, parcels_unresolved: 2,
}

function cell(name: string): HTMLElement {
  return screen.getByText(name).closest('div')!
}

describe('IncidentStatusStrip', () => {
  it('keeps trip closed, exceptions reviewed and incident open as three separate answers', () => {
    // Arrange / Act
    render(<IncidentStatusStrip incident={BASE} />)

    // Assert
    expect(within(cell('Trip')).getByText('Complete')).toBeInTheDocument()
    expect(within(cell('Exceptions')).getByText('2 of 3 reviewed')).toBeInTheDocument()
    expect(within(cell('Incident')).getByText('Investigating')).toBeInTheDocument()
  })

  it('says when this incident stopped the trip', () => {
    // Arrange / Act
    render(<IncidentStatusStrip incident={{ ...BASE, trip_status: 'cancelled', trip_stopped_at: '2026-10-20T10:05:00Z' }} />)

    // Assert
    expect(screen.getByText('Stopped by this incident')).toBeInTheDocument()
  })

  it('shows the outcome once closed', () => {
    // Arrange / Act
    render(<IncidentStatusStrip incident={{ ...BASE, status: 'closed', outcome: 'partial_recovery' }} />)

    // Assert
    expect(screen.getByText('Partial recovery')).toBeInTheDocument()
  })
})
