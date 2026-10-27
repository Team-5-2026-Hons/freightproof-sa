import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import IncidentsPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { useIncidents } from '@/lib/hooks/useIncidents'
import type { IncidentListFilters, IncidentSummary } from '@/lib/types/incident'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
const replace = vi.fn()
const urlQuery = vi.hoisted(() => ({ current: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
  usePathname: () => '/incidents',
  useSearchParams: () => new URLSearchParams(urlQuery.current),
}))
vi.mock('@/lib/hooks/useIncidents', () => ({ useIncidents: vi.fn() }))

const mockedUseIncidents = vi.mocked(useIncidents)

function incident(overrides: Partial<IncidentSummary>): IncidentSummary {
  return {
    incident_id: 'inc', reference: 'INC1', trip_id: 'trip', trip_reference: 'FP-A', trip_status: 'active',
    incident_type: 'hijacking', summary: 'Armed men stopped the truck.', status: 'open', confidence: 'reported',
    outcome: null, assigned_to_user_id: null, assigned_to_name: null, reported_occurred_at: null,
    received_at: '2026-10-20T10:00:00Z', trip_stopped_at: null, closed_at: null, created_at: '2026-10-20T10:00:00Z',
    exception_ids: [], exceptions_total: 0, exceptions_reviewed: 0, parcels_total: 0, parcels_unresolved: 0,
    ...overrides,
  } as IncidentSummary
}

const ALPHA = incident({ incident_id: 'a', reference: 'INC1', trip_reference: 'FP-ALPHA', summary: 'Armed men stopped the truck.', received_at: '2026-10-01T00:00:00Z' })
const BRAVO = incident({ incident_id: 'b', reference: 'INC2', trip_reference: 'FP-BRAVO', summary: 'Seven parcels short at unloading.', incident_type: 'parcel_shortage', received_at: '2026-10-10T00:00:00Z' })
const CHARLIE = incident({ incident_id: 'c', reference: 'INC3', trip_reference: 'FP-CHARLIE', summary: 'Cartons crushed.', incident_type: 'parcel_damage', received_at: '2026-10-05T00:00:00Z' })

function renderPage() {
  return render(<ForensicModeProvider><IncidentsPage /></ForensicModeProvider>)
}

/** Trip references in the order the table shows them. */
function shownOrder(): string[] {
  return screen.getAllByRole('link', { name: /FP-/ }).map(link => link.textContent?.split(' · ')[0] ?? '')
}

function lastFilters(): IncidentListFilters {
  return mockedUseIncidents.mock.calls.at(-1)![0]
}

describe('IncidentsPage', () => {
  beforeEach(() => {
    mockedUseIncidents.mockReset()
    replace.mockReset()
    urlQuery.current = ''
    mockedUseIncidents.mockReturnValue({ data: [ALPHA, BRAVO, CHARLIE], isLoading: false, error: null, refetch: vi.fn(), refetchSilent: vi.fn() })
  })

  it('opens_on_all_incidents_newest_received_first', () => {
    renderPage()

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    expect(lastFilters()).toEqual({ status: undefined, incident_type: undefined, assigned_to: undefined })
    expect(shownOrder()).toEqual(['FP-BRAVO', 'FP-CHARLIE', 'FP-ALPHA'])
  })

  it('keeps_the_report_hint_behind_an_info_button_beside_the_title', () => {
    renderPage()

    expect(screen.queryByText("Report an incident from a trip's Info tab, or from an exception.")).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'About incidents' }))

    expect(screen.getByText("Report an incident from a trip's Info tab, or from an exception.")).toBeInTheDocument()
  })

  it('asks_the_server_for_the_status_a_tab_names', () => {
    renderPage()

    fireEvent.click(screen.getByRole('tab', { name: 'Investigating' }))

    expect(screen.getByRole('tab', { name: 'Investigating' })).toHaveAttribute('aria-selected', 'true')
    expect(lastFilters().status).toBe('investigating')
  })

  it('asks_the_server_for_my_incidents_and_the_chosen_type', () => {
    renderPage()

    fireEvent.change(screen.getByRole('combobox', { name: 'Investigated by' }), { target: { value: 'mine' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Incident type' }), { target: { value: 'hijacking' } })

    expect(lastFilters()).toEqual({ status: undefined, incident_type: 'hijacking', assigned_to: 'me' })
  })

  it('narrows_the_rows_as_the_dispatcher_searches', () => {
    renderPage()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search incidents' }), { target: { value: 'parcels short' } })

    expect(shownOrder()).toEqual(['FP-BRAVO'])
    expect(screen.getByText('1 incident')).toBeInTheDocument()
  })

  it('shows_a_filter_specific_empty_state_and_clears_everything_from_it', () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Closed' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search incidents' }), { target: { value: 'zzz-no-such' } })

    expect(screen.getByText('Nothing matches these filters')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('searchbox', { name: 'Search incidents' })).toHaveValue('')
    expect(lastFilters()).toEqual({ status: undefined, incident_type: undefined, assigned_to: undefined })
    expect(shownOrder()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('says_there_are_no_incidents_yet_when_nothing_is_filtered', () => {
    mockedUseIncidents.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn(), refetchSilent: vi.fn() })
    renderPage()

    expect(screen.getByText('No incidents yet')).toBeInTheDocument()
    expect(screen.queryByText('Nothing matches these filters')).toBeNull()
  })

  it('sorts_by_a_header_click_and_flips_on_a_second_click', () => {
    renderPage()
    const table = screen.getByRole('table')

    fireEvent.click(within(table).getByRole('button', { name: /^Incident/ }))
    expect(shownOrder()).toEqual(['FP-ALPHA', 'FP-BRAVO', 'FP-CHARLIE'])

    fireEvent.click(within(table).getByRole('button', { name: /^Incident/ }))
    expect(shownOrder()).toEqual(['FP-CHARLIE', 'FP-BRAVO', 'FP-ALPHA'])
  })

  it('pages_client_side_and_returns_to_page_one_when_the_search_changes', () => {
    const many = Array.from({ length: 30 }, (_, i) => incident({
      incident_id: `m${i}`, reference: `INC${i}`, trip_reference: `FP-${String(i).padStart(3, '0')}`,
      received_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    }))
    mockedUseIncidents.mockReturnValue({ data: many, isLoading: false, error: null, refetch: vi.fn(), refetchSilent: vi.fn() })
    renderPage()

    expect(shownOrder()).toHaveLength(25)
    expect(screen.getByText('1–25 of 30')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('26–30 of 30')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search incidents' }), { target: { value: 'FP-00' } })
    expect(screen.getByText('Page 1')).toBeInTheDocument()
  })

  it('opens_with_the_filters_the_url_names', () => {
    urlQuery.current = 'status=closed&type=hijacking&owner=mine&q=FP-A'

    renderPage()

    expect(screen.getByRole('tab', { name: 'Closed' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('combobox', { name: 'Incident type' })).toHaveValue('hijacking')
    expect(screen.getByRole('combobox', { name: 'Investigated by' })).toHaveValue('mine')
    expect(screen.getByRole('searchbox', { name: 'Search incidents' })).toHaveValue('FP-A')
    expect(lastFilters()).toEqual({ status: 'closed', incident_type: 'hijacking', assigned_to: 'me' })
  })

  it('writes_a_changed_filter_to_the_url_with_replace', () => {
    renderPage()

    fireEvent.click(screen.getByRole('tab', { name: 'Investigating' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Incident type' }), { target: { value: 'hijacking' } })

    expect(replace).toHaveBeenLastCalledWith('/incidents?status=investigating&type=hijacking', { scroll: false })
  })

  it('clears_the_url_with_the_filters', () => {
    urlQuery.current = 'status=closed&q=zzz-no-such'
    renderPage()

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)

    expect(replace).toHaveBeenLastCalledWith('/incidents', { scroll: false })
  })
})
