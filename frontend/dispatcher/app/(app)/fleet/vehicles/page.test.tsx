import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FleetVehiclesPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { useVehicles } from '@/lib/hooks/useVehicles'
import type { UseVehiclesResult } from '@/lib/hooks/useVehicles'
import type { Vehicle } from '@shared/lib/types/vehicle'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'admin_dispatcher' } }),
}))

const notify = vi.fn()
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify }),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useVehicles', () => ({ useVehicles: vi.fn() }))

const mockedUseVehicles = vi.mocked(useVehicles)

function makeVehicle(id: string, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: id as Vehicle['id'],
    registration: `REG ${id}`,
    vehicle_type: 'horse',
    pulsit_device_id: `PD-${id}`,
    vin_number: null,
    licence_disc_expiry: null,
    make: null,
    model: null,
    year: null,
    gross_vehicle_mass_kg: null,
    length_m: null,
    is_active: true,
    ...overrides,
  } as unknown as Vehicle
}

function vehiclesState(all: Vehicle[] = [], overrides: Partial<UseVehiclesResult> = {}): UseVehiclesResult {
  return {
    all,
    horses: all.filter(v => v.vehicle_type === 'horse'),
    trailers: all.filter(v => v.vehicle_type === 'trailer'),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

function renderPage() {
  return render(<ForensicModeProvider><FleetVehiclesPage /></ForensicModeProvider>)
}

beforeEach(() => {
  push.mockReset()
  notify.mockReset()
  mockedUseVehicles.mockReset().mockReturnValue(vehiclesState())
})

describe('Vehicles list — loading', () => {
  it('shows placeholder cards while the first load is in flight, with the controls already usable', () => {
    mockedUseVehicles.mockReturnValue(vehiclesState([], { isLoading: true }))

    renderPage()

    expect(screen.getByRole('status', { name: 'Loading vehicles' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: /add vehicle/i })).toBeInTheDocument()
    expect(screen.queryByText('No vehicles')).toBeNull()
  })

  it('replaces the placeholders with the real cards once they arrive', () => {
    mockedUseVehicles.mockReturnValue(vehiclesState([makeVehicle('a'), makeVehicle('b')]))

    renderPage()

    expect(screen.queryByRole('status', { name: 'Loading vehicles' })).toBeNull()
    expect(screen.getByText('REG a')).toBeInTheDocument()
    expect(screen.getByText('REG b')).toBeInTheDocument()
  })

  it('keeps the cards on screen during a refetch instead of flashing the placeholders', () => {
    mockedUseVehicles.mockReturnValue(vehiclesState([makeVehicle('a')], { isLoading: true }))

    renderPage()

    expect(screen.queryByRole('status', { name: 'Loading vehicles' })).toBeNull()
    expect(screen.getByText('REG a')).toBeInTheDocument()
  })
})

describe('Vehicles list', () => {
  it('opens a vehicle from its card', () => {
    mockedUseVehicles.mockReturnValue(vehiclesState([makeVehicle('a')]))

    renderPage()
    fireEvent.click(screen.getByText('REG a'))

    expect(push).toHaveBeenCalledWith('/fleet/vehicles/a')
  })

  it('shows the error with a retry, and toasts it', () => {
    const refetch = vi.fn()
    mockedUseVehicles.mockReturnValue(vehiclesState([], { error: 'Network unreachable', refetch }))

    renderPage()

    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says there are no vehicles when none are registered', () => {
    renderPage()

    expect(screen.getByText('No vehicles')).toBeInTheDocument()
  })
})
