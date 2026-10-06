import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

import { TripCreatedDetail } from '../TripCreatedDetail'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { ConsignmentRead, Trip } from '@shared/lib/types/trip'

function waybill(reference: string, parcels: number, units: number | null): ConsignmentRead {
  return {
    id: `c-${reference}`, trip_id: mockTrips[0].id, parcel_perfect_reference: reference,
    client_organization_id: null, origin_precinct_id: null, destination_precinct_id: null,
    declared_value: 15800, parcel_count_expected: parcels, slot_time_origin: null,
    slot_time_destination: null, pp_raw_json: null, pickup_stop_id: null, delivery_stop_id: null,
    load_priority: null, unit_count_expected: units, pp_manifest_number: 81,
    scanned_out_count: 0, scanned_in_count: 0,
    created_at: '2026-10-02T11:00:00Z', updated_at: '2026-10-02T11:00:00Z',
  }
}

function tripWith(consignments: ConsignmentRead[]): Trip {
  return {
    ...mockTrips[0],
    trip_type: 'loaded',
    pp_manifest: { issuer_account: 'MOCK01', origin_hub: 'CPT', number: 81, display: 'CGY Logistics · CPT 81' },
    blockchain_receipts: [],
    consignments,
  }
}

describe('TripCreatedDetail', () => {
  it('shows parcels only when a manifest trip has no unit counts, never "0 units"', () => {
    render(<TripCreatedDetail trip={tripWith([waybill('MFTWB8101', 6, null), waybill('MFTWB8102', 4, null)])} />)

    expect(screen.getByText('Waybills (2)')).toBeInTheDocument()
    expect(screen.getByText('10 parcels')).toBeInTheDocument()
    expect(screen.queryByText(/units/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Manifest 81/)).toHaveLength(2)
  })

  it('totals units when every waybill has a count', () => {
    render(<TripCreatedDetail trip={tripWith([waybill('WAY001', 6, 2), waybill('WAY002', 4, 1)])} />)

    expect(screen.getByText('3 units · 10 parcels')).toBeInTheDocument()
  })

  it('shows the locked manifest beside the other trip parameters', () => {
    render(<TripCreatedDetail trip={tripWith([])} />)

    expect(screen.getByText('CGY Logistics · CPT 81')).toBeInTheDocument()
    expect(screen.getByText('Planned departure')).toBeInTheDocument()
  })
})
