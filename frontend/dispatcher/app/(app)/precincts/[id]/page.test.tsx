import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import PrecinctDetailPage from './page'
import { usePrecinctDetail } from '@/lib/hooks/usePrecinctDetail'
import type { PrecinctDetail } from '@shared/lib/types/precinct'

const PRECINCT_ID = '11111111-1111-1111-1111-111111111111'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: PRECINCT_ID }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// client.ts imports the Supabase client at module scope, which throws without real env
// vars — mocked the same way the other detail page tests do.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// The page and AdminOnly read the signed-in user. Nothing asserted here depends on who
// that is.
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

vi.mock('@/lib/hooks/usePrecinctDetail', () => ({
  usePrecinctDetail: vi.fn(),
}))

// Leaflet cannot render in jsdom, and the map is not what these tests are about.
vi.mock('@/components/map/GeofenceMap', () => ({
  GeofenceMap: () => null,
}))

// The summary fetches and has its own tests. Here only whether it mounts, and for which
// precinct, matters.
vi.mock('@/components/analytics/PrecinctAnalyticsSummary', () => ({
  PrecinctAnalyticsSummary: ({ precinctId }: { precinctId: string }) => <p>Analytics for {precinctId}</p>,
}))

const mockedUsePrecinctDetail = vi.mocked(usePrecinctDetail)

// Title EventTimeline gives a precinct's 'created' event, used to tell that it rendered.
const TIMELINE_ENTRY = 'Precinct mapped'
const ANCHORING_NOTE = /Anchoring records are shown to administrators/

function makePrecinct(overrides: Partial<PrecinctDetail> = {}): PrecinctDetail {
  return {
    id: PRECINCT_ID as PrecinctDetail['id'],
    name: 'Test Depot',
    principal_organization_id: '22222222-2222-2222-2222-222222222222' as PrecinctDetail['principal_organization_id'],
    address: null,
    latitude: -29.0852,
    longitude: 26.1596,
    geofence_radius_metres: 200,
    is_shared: true,
    created_at: '2026-09-01T08:00:00Z',
    events: [{
      id: '33333333-3333-3333-3333-333333333333',
      precinct_id: PRECINCT_ID,
      event_type: 'created',
      changed_fields: {},
      changed_by_user_id: '44444444-4444-4444-4444-444444444444',
      blockchain_receipt_id: null,
      created_at: '2026-09-01T08:00:00Z',
    }],
    receipts: [],
    ...overrides,
  }
}

function renderPage(precinct: PrecinctDetail) {
  mockedUsePrecinctDetail.mockReturnValue({ precinct, isLoading: false, error: null, refetch: vi.fn() })
  render(<PrecinctDetailPage />)
}

describe('Precinct detail — change history / analytics', () => {
  it('opens on the change history exactly as before, anchoring note included', () => {
    renderPage(makePrecinct())

    expect(screen.getByRole('tab', { name: 'Change History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Analytics' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText(TIMELINE_ENTRY)).toBeInTheDocument()
    expect(screen.getByText(ANCHORING_NOTE)).toBeInTheDocument()
    expect(screen.queryByText(/Analytics for/)).not.toBeInTheDocument()
  })

  it("switches to this precinct's analytics", () => {
    renderPage(makePrecinct())

    fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }))

    expect(screen.getByRole('tabpanel', { name: 'Analytics' })).toHaveTextContent(`Analytics for ${PRECINCT_ID}`)
    expect(screen.queryByText(TIMELINE_ENTRY)).not.toBeInTheDocument()
    expect(screen.queryByText(ANCHORING_NOTE)).not.toBeInTheDocument()
  })
})
