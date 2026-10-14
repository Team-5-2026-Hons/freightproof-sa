import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VehicleModal } from './VehicleModal'
import type { VehicleRef } from '@/lib/phase/trip-detail'

function vehicleRef(overrides: Partial<VehicleRef> = {}): VehicleRef {
  return {
    id: 'vehicle-1',
    registration: 'GP 12-34 ZX',
    make: null,
    model: null,
    year: null,
    vin_number: null,
    gross_vehicle_mass_kg: null,
    length_m: null,
    ...overrides,
  }
}

describe('VehicleModal', () => {
  it('renders nothing once the vehicle id is unknown, rather than opening on a guess', () => {
    const { container } = render(
      <VehicleModal vehicle={vehicleRef({ id: null })} role="Horse" open onClose={vi.fn()} returnTo="/trips/x" />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows recorded fleet fields and says so plainly when they are unrecorded', () => {
    render(<VehicleModal vehicle={vehicleRef({ make: 'Scania', model: 'R500' })} role="Horse" open onClose={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByText('Scania')).toBeInTheDocument()
    expect(screen.getByText('R500')).toBeInTheDocument()
    // VIN was never overridden, so this is the null-fields path, not a stub value.
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0)
  })

  it('sends "View vehicle" to the fleet record with the trip carried as returnTo', () => {
    render(<VehicleModal vehicle={vehicleRef()} role="Trailer" open onClose={vi.fn()} returnTo="/trips/trip-9" />)

    const link = screen.getByRole('link', { name: 'View vehicle' })
    expect(link).toHaveAttribute('href', '/fleet/vehicles/vehicle-1?returnTo=%2Ftrips%2Ftrip-9')
  })

  it('closes the preview when "View vehicle" is followed, so it is not still open on return', async () => {
    const onClose = vi.fn()
    render(<VehicleModal vehicle={vehicleRef()} role="Horse" open onClose={onClose} returnTo="/trips/x" />)

    await userEvent.click(screen.getByRole('link', { name: 'View vehicle' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers an explicit Close, matching every other modal in the app', async () => {
    const onClose = vi.fn()
    render(<VehicleModal vehicle={vehicleRef()} role="Horse" open onClose={onClose} returnTo="/trips/x" />)

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
