import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import VehicleDetailPage from './page'
import { useVehicleDetail } from '@/lib/hooks/useVehicleDetail'
import type { VehicleDetail } from '@shared/lib/types/vehicle'

const VEHICLE_ID = '11111111-1111-1111-1111-111111111111'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: VEHICLE_ID }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

vi.mock('@/lib/hooks/useVehicleDetail', () => ({
  useVehicleDetail: vi.fn(),
}))

vi.mock('@/components/analytics/VehicleAnalyticsSummary', () => ({
  VehicleAnalyticsSummary: ({ vehicleId, vehicleType }: { vehicleId: string; vehicleType: string }) => (
    <p>Analytics for {vehicleId} ({vehicleType})</p>
  ),
}))

const mockedUseVehicleDetail = vi.mocked(useVehicleDetail)

const TIMELINE_ENTRY = 'Created'

function makeVehicle(overrides: Partial<VehicleDetail> = {}): VehicleDetail {
  return {
    id: VEHICLE_ID as VehicleDetail['id'],
    organization_id: '22222222-2222-2222-2222-222222222222',
    registration: 'CA 123-456',
    vehicle_type: 'horse',
    pulsit_device_id: 'PULSIT-001',
    is_active: true,
    make: null,
    model: null,
    year: null,
    vin_number: null,
    licence_disc_expiry: null,
    gross_vehicle_mass_kg: null,
    length_m: null,
    created_at: '2026-09-01T08:00:00Z',
    events: [{
      id: '33333333-3333-3333-3333-333333333333',
      vehicle_id: VEHICLE_ID,
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

function renderPage(vehicle: VehicleDetail) {
  mockedUseVehicleDetail.mockReturnValue({
    data: vehicle, isLoading: false, error: null, refetch: vi.fn(), refetchSilent: vi.fn(),
  })
  render(<VehicleDetailPage />)
}

describe('Vehicle detail — right panel for a horse', () => {
  it('offers history and analytics, opening on history exactly as before', () => {
    renderPage(makeVehicle({ vehicle_type: 'horse' }))

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Immutable History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Analytics' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText(TIMELINE_ENTRY)).toBeInTheDocument()
    expect(screen.queryByText(/Analytics for/)).not.toBeInTheDocument()
  })

  it("switches to this vehicle's analytics", () => {
    renderPage(makeVehicle({ vehicle_type: 'horse' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }))

    expect(screen.getByRole('tabpanel', { name: 'Analytics' })).toHaveTextContent(`Analytics for ${VEHICLE_ID}`)
    expect(screen.queryByText(TIMELINE_ENTRY)).not.toBeInTheDocument()
  })
})

describe('Vehicle detail — right panel for a trailer', () => {
  it('offers history and analytics, opening on history', () => {
    renderPage(makeVehicle({ vehicle_type: 'trailer' }))

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Immutable History' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Analytics' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText(TIMELINE_ENTRY)).toBeInTheDocument()
  })

  it("switches to this trailer's analytics, telling the summary it is a trailer", () => {
    renderPage(makeVehicle({ vehicle_type: 'trailer' }))

    fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }))

    expect(screen.getByRole('tabpanel', { name: 'Analytics' }))
      .toHaveTextContent(`Analytics for ${VEHICLE_ID} (trailer)`)
    expect(screen.queryByText(TIMELINE_ENTRY)).not.toBeInTheDocument()
  })
})

describe('Vehicle detail — loading', () => {
  it('shows the header with its back button over a skeleton, not a spinner, while the record loads', () => {
    mockedUseVehicleDetail.mockReturnValue({
      data: null, isLoading: true, error: null, refetch: vi.fn(), refetchSilent: vi.fn(),
    })

    render(<VehicleDetailPage />)

    expect(screen.getByRole('status', { name: 'Loading vehicle' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Vehicle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })
})

describe('Vehicle detail — failed refresh', () => {
  it('keeps the page and flags the error inline when a refresh fails with data on screen', () => {
    mockedUseVehicleDetail.mockReturnValue({
      data: makeVehicle(), isLoading: false, error: 'Network error', refetch: vi.fn(), refetchSilent: vi.fn(),
    })

    render(<VehicleDetailPage />)

    expect(screen.queryByText('Could not load vehicle.')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Immutable History' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Network error')
  })

  it('still replaces the page with "Could not load" when nothing has loaded', () => {
    mockedUseVehicleDetail.mockReturnValue({
      data: null, isLoading: false, error: 'Network error', refetch: vi.fn(), refetchSilent: vi.fn(),
    })

    render(<VehicleDetailPage />)

    expect(screen.getByText('Could not load vehicle.')).toBeInTheDocument()
  })
})
