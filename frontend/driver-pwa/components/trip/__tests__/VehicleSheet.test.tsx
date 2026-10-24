import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { VehicleSheet } from '../VehicleSheet'
import type { Vehicle } from '@shared/lib/types/vehicle'

function vehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    id: 'v' as Vehicle['id'], organization_id: 'o', registration: 'GP 12-34 ZX', vehicle_type: 'horse',
    pulsit_device_id: 'p', is_active: true, make: null, model: null, year: null, vin_number: null,
    licence_disc_expiry: null, gross_vehicle_mass_kg: null, length_m: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('VehicleSheet', () => {
  it('test_shows_the_truck_with_only_the_details_on_record', () => {
    render(
      <VehicleSheet
        open
        onClose={vi.fn()}
        horse={vehicle({ make: 'Volvo', model: 'FH 520', year: 2022, licence_disc_expiry: '2027-03-12' })}
        trailers={[]}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Vehicles on this trip' })
    expect(within(dialog).getByText('GP 12-34 ZX')).toBeInTheDocument()
    expect(within(dialog).getByText('Volvo FH 520 · 2022')).toBeInTheDocument()
    expect(within(dialog).getByText('12 Mar 2027')).toBeInTheDocument()
    // No mass or length on record: no empty "—" rows.
    expect(within(dialog).queryByText(/Gross mass/)).toBeNull()
  })

  it('test_lists_each_trailer_by_its_plate', () => {
    render(
      <VehicleSheet
        open
        onClose={vi.fn()}
        horse={vehicle({})}
        trailers={[
          vehicle({ id: 't-1' as Vehicle['id'], registration: 'KZN T 5678', vehicle_type: 'trailer' }),
          vehicle({ id: 't-2' as Vehicle['id'], registration: 'GP T 9012', vehicle_type: 'trailer' }),
        ]}
      />,
    )

    expect(screen.getByText('KZN T 5678')).toBeInTheDocument()
    expect(screen.getByText('GP T 9012')).toBeInTheDocument()
    expect(screen.getByText('Trailers · 2')).toBeInTheDocument()
  })
})
