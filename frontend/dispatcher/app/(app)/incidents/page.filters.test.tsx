import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import IncidentsPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { listIncidents } from '@/lib/api/incidents'
import { useRealtimeChannel } from '@/lib/realtime/RealtimeProvider'
import type { IncidentListFilters, IncidentSummary } from '@/lib/types/incident'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))
vi.mock('@/lib/api/incidents', () => ({ listIncidents: vi.fn(), getIncident: vi.fn(), getIncidentEvidence: vi.fn() }))
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }))
vi.mock('@/lib/realtime/RealtimeProvider', () => ({ useRealtimeChannel: vi.fn() }))
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/incidents',
  useSearchParams: () => new URLSearchParams(),
}))

function incident(id: string, tripReference: string, status: IncidentSummary['status']): IncidentSummary {
  return {
    incident_id: id, reference: `INC-${id}`, trip_id: `trip-${id}`, trip_reference: tripReference, trip_status: 'active',
    incident_type: 'hijacking', summary: 'Armed men stopped the truck.', status, confidence: 'reported',
    outcome: null, assigned_to_user_id: null, assigned_to_name: null, reported_occurred_at: null,
    received_at: '2026-10-20T10:00:00Z', trip_stopped_at: null, closed_at: null, created_at: '2026-10-20T10:00:00Z',
    exception_ids: [], exceptions_total: 0, exceptions_reviewed: 0, parcels_total: 0, parcels_unresolved: 0,
  } as IncidentSummary
}

const INVESTIGATING = incident('inv', 'FP-INVESTIGATING', 'investigating')
const CLOSED = incident('clo', 'FP-CLOSED', 'closed')

async function fakeServer(filters?: IncidentListFilters): Promise<IncidentSummary[]> {
  const all = [INVESTIGATING, CLOSED]
  return filters?.status ? all.filter(i => i.status === filters.status) : all
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve() }) }

describe('IncidentsPage status tabs', () => {
  beforeEach(() => {
    vi.mocked(listIncidents).mockReset()
    vi.mocked(listIncidents).mockImplementation(fakeServer)
    vi.mocked(useRealtimeChannel).mockReturnValue({ status: 'live', subscribe: () => () => {}, reconnectNonce: 0 })
  })

  it('hides_an_investigating_incident_when_the_closed_tab_is_picked', async () => {
    render(<ForensicModeProvider><IncidentsPage /></ForensicModeProvider>)
    await flush()
    expect(screen.getByRole('link', { name: /FP-INVESTIGATING/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Closed' }))
    await flush()

    expect(screen.queryByRole('link', { name: /FP-INVESTIGATING/ })).toBeNull()
    expect(screen.getByRole('link', { name: /FP-CLOSED/ })).toBeInTheDocument()
  })

  it('carries_the_filtered_list_into_each_row_link_as_returnTo', async () => {
    render(<ForensicModeProvider><IncidentsPage /></ForensicModeProvider>)
    await flush()
    fireEvent.click(screen.getByRole('tab', { name: 'Closed' }))
    await flush()

    const href = screen.getByRole('link', { name: /FP-CLOSED/ }).getAttribute('href') ?? ''
    const returnTo = new URL(href, 'https://x.invalid').searchParams.get('returnTo') ?? ''

    expect(href.startsWith('/incidents/clo')).toBe(true)
    expect(returnTo.startsWith('/incidents?')).toBe(true)
    expect(new URLSearchParams(returnTo.split('?')[1]).toString()).toContain('closed')
  })
})
