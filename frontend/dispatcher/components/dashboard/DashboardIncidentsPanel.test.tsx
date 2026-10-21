import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardIncidentsPanel } from './DashboardIncidentsPanel'
import { useIncidents } from '@/lib/hooks/useIncidents'
import type { AsyncState } from '@/lib/hooks/useAsyncData'
import type { IncidentSummary } from '@/lib/types/incident'

vi.mock('@/lib/hooks/useIncidents', () => ({ useIncidents: vi.fn() }))
const mockedIncidents = vi.mocked(useIncidents)

const incident = (id: string, overrides: Partial<IncidentSummary> = {}): IncidentSummary => ({
  incident_id: id, reference: `INC-${id}`, trip_reference: `FP-${id}`, incident_type: 'hijacking', status: 'open',
  received_at: '2026-10-20T08:00:00Z', ...overrides,
}) as unknown as IncidentSummary

const incidentsState = (overrides: Partial<AsyncState<IncidentSummary[]>> = {}): AsyncState<IncidentSummary[]> =>
  ({ data: [], isLoading: false, error: null, refetch: vi.fn(), refetchSilent: vi.fn(), ...overrides }) as AsyncState<IncidentSummary[]>

beforeEach(() => { mockedIncidents.mockReset().mockReturnValue(incidentsState()) })

describe('DashboardIncidentsPanel', () => {
  it('shows five open incidents, the open total, and a link to the full list', () => {
    const data = Array.from({ length: 8 }, (_, i) => incident(`i${i}`))
    mockedIncidents.mockReturnValue(incidentsState({ data }))

    render(<DashboardIncidentsPanel />)

    expect(within(screen.getByRole('table', { name: 'Open incidents' })).getAllByRole('row')).toHaveLength(1 + 5)
    expect(screen.getByText('8 open')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View all incidents/ })).toHaveAttribute('href', '/incidents')
  })

  it('leaves closed incidents out of both the rows and the count', () => {
    const data = [incident('live'), incident('done', { status: 'closed' })]
    mockedIncidents.mockReturnValue(incidentsState({ data }))

    render(<DashboardIncidentsPanel />)

    expect(screen.getByText('1 open')).toBeInTheDocument()
    expect(screen.queryByText(/FP-done/)).not.toBeInTheDocument()
  })

  it('says no incidents are open when all are closed', () => {
    mockedIncidents.mockReturnValue(incidentsState({ data: [incident('done', { status: 'closed' })] }))

    render(<DashboardIncidentsPanel />)

    expect(screen.getByText('No open incidents')).toBeInTheDocument()
  })

  it('shows a failure with a retry rather than an empty list', () => {
    const refetch = vi.fn()
    mockedIncidents.mockReturnValue(incidentsState({ error: 'Network down', refetch }))

    render(<DashboardIncidentsPanel />)

    expect(screen.getByText('Failed to load incidents')).toBeInTheDocument()
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(refetch).toHaveBeenCalledOnce()
  })
})
