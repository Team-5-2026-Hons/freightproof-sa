import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import DriverDetailPage from './page'
import { useDriverDetail } from '@/lib/hooks/useDriverDetail'
import type { DriverDetail } from '@shared/lib/types/driver'

const DRIVER_ID = '11111111-1111-1111-1111-111111111111'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: DRIVER_ID }),
  useRouter: () => ({ push: vi.fn() }),
}))

// client.ts imports the Supabase client at module scope, which throws without real env
// vars — mocked the same way the other detail page tests do.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// AdminOnly reads the signed-in user. Nothing asserted here depends on who that is.
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

vi.mock('@/lib/hooks/useDriverDetail', () => ({
  useDriverDetail: vi.fn(),
}))

// The summary fetches and has its own tests. Here only whether it mounts, and for which
// driver, matters.
vi.mock('@/components/analytics/DriverAnalyticsSummary', () => ({
  DriverAnalyticsSummary: ({ driverId }: { driverId: string }) => <p>Analytics for {driverId}</p>,
}))

const mockedUseDriverDetail = vi.mocked(useDriverDetail)

// Title EventTimeline gives a 'created' event, used to tell that the timeline rendered.
const TIMELINE_ENTRY = 'Created'

function makeDriver(overrides: Partial<DriverDetail> = {}): DriverDetail {
  return {
    id: DRIVER_ID as DriverDetail['id'],
    organization_id: '22222222-2222-2222-2222-222222222222',
    full_name: 'Test Driver',
    id_number: '9001015009087',
    phone_number: '+27821234567',
    license_number: 'DL-0001',
    license_expiry: null,
    is_active: true,
    idvs_status: 'verified',
    idvs_last_verified_at: null,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    events: [{
      id: '33333333-3333-3333-3333-333333333333',
      driver_id: DRIVER_ID,
      event_type: 'created',
      changed_fields: {},
      changed_by_user_id: '44444444-4444-4444-4444-444444444444',
      blockchain_receipt_id: null,
      created_at: '2026-09-01T08:00:00Z',
    }],
    receipts: [],
    trip_ids: [],
    ...overrides,
  }
}

function renderPage(driver: DriverDetail) {
  mockedUseDriverDetail.mockReturnValue({
    data: driver, isLoading: false, error: null, refetch: vi.fn(), refetchSilent: vi.fn(),
  })
  render(<DriverDetailPage />)
}

describe('Driver detail — right panel', () => {
  it('offers history and analytics, opening on history exactly as before', () => {
    renderPage(makeDriver())

    expect(screen.getByRole('tab', { name: 'Immutable History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Analytics' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText(TIMELINE_ENTRY)).toBeInTheDocument()
    expect(screen.queryByText(/Analytics for/)).not.toBeInTheDocument()
  })

  it("switches to this driver's analytics", () => {
    renderPage(makeDriver())

    fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }))

    expect(screen.getByRole('tabpanel', { name: 'Analytics' })).toHaveTextContent(`Analytics for ${DRIVER_ID}`)
    expect(screen.queryByText(TIMELINE_ENTRY)).not.toBeInTheDocument()
  })
})
