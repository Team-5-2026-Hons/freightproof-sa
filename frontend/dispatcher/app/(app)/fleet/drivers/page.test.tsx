import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FleetDriversPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { api } from '@/lib/api/client'
import { useDrivers } from '@/lib/hooks/useDrivers'
import type { UseDriversResult } from '@/lib/hooks/useDrivers'
import type { Driver } from '@shared/lib/types/driver'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

const mockUser = vi.hoisted(() => ({ current: { id: 'me', role: 'admin_dispatcher' } as { id: string; role: string } | null }))
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

const notify = vi.fn()
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/lib/hooks/useDrivers', () => ({ useDrivers: vi.fn() }))
vi.mock('@/lib/api/client', () => ({ api: { post: vi.fn(), get: vi.fn() } }))

const mockedUseDrivers = vi.mocked(useDrivers)
const mockedPost = vi.mocked(api.post)

function makeDriver(id: string, overrides: Partial<Driver> = {}): Driver {
  return {
    id: id as Driver['id'],
    organization_id: 'org',
    full_name: `Driver ${id}`,
    id_number: '8001015009087',
    phone_number: '0821234567',
    license_number: `DRV-${id}`,
    license_expiry: '2030-01-01',
    is_active: true,
    idvs_status: 'verified',
    idvs_last_verified_at: null,
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    ...overrides,
  }
}

function driversState(overrides: Partial<UseDriversResult> = {}): UseDriversResult {
  return { drivers: [], isLoading: false, error: null, refetch: vi.fn(), ...overrides }
}

function renderPage() {
  return render(<ForensicModeProvider><FleetDriversPage /></ForensicModeProvider>)
}

// Names in the order the rows appear.
const rowNames = (): string[] => screen.getAllByRole('row').slice(1).map(row => within(row).getByRole('link').textContent ?? '')

beforeEach(() => {
  notify.mockReset()
  mockedPost.mockReset()
  mockUser.current = { id: 'me', role: 'admin_dispatcher' }
  mockedUseDrivers.mockReset().mockReturnValue(driversState())
})

describe('Drivers list', () => {
  it('renders every column, links each row, and masks the ID number', () => {
    mockedUseDrivers.mockReturnValue(driversState({ drivers: [makeDriver('a', { full_name: 'Sipho Dlamini' })] }))

    renderPage()

    for (const name of ['Name', 'ID number', 'Phone', 'Licence expiry', 'Status', 'Added']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(name, 'i') })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Sipho Dlamini' })).toHaveAttribute('href', '/fleet/drivers/a')
    expect(screen.getByText('···· 9087')).toBeInTheDocument()
    expect(screen.queryByText(/8001015009087/)).toBeNull()
  })

  it('opens newest first and marks the Added column as sorted', () => {
    mockedUseDrivers.mockReturnValue(driversState({
      drivers: [
        makeDriver('old', { full_name: 'Old Hand', created_at: '2026-01-01T00:00:00Z' }),
        makeDriver('new', { full_name: 'New Hire', created_at: '2026-10-01T00:00:00Z' }),
      ],
    }))

    renderPage()

    expect(rowNames()).toEqual(['New Hire', 'Old Hand'])
    expect(screen.getByRole('columnheader', { name: /added/i })).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts by a header and reverses on a second click', () => {
    mockedUseDrivers.mockReturnValue(driversState({
      drivers: [makeDriver('z', { full_name: 'Zane' }), makeDriver('a', { full_name: 'Aisha' })],
    }))

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /name/i }))
    expect(rowNames()).toEqual(['Aisha', 'Zane'])
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(screen.getByRole('button', { name: /name/i }))
    expect(rowNames()).toEqual(['Zane', 'Aisha'])
  })

  it('does not offer sorting on columns that have no sort', () => {
    mockedUseDrivers.mockReturnValue(driversState({ drivers: [makeDriver('a')] }))

    renderPage()

    expect(screen.queryByRole('button', { name: /^phone/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /id number/i })).toBeNull()
  })

  it.each([
    ['name', 'zane'],
    ['phone', '0719999999'],
    ['licence number', 'LIC-ZZ'],
    ['full ID number', '9001015009081'],
  ])('finds a driver by %s', (_what, term) => {
    mockedUseDrivers.mockReturnValue(driversState({
      drivers: [
        makeDriver('a', { full_name: 'Aisha' }),
        makeDriver('z', { full_name: 'Zane', phone_number: '0719999999', license_number: 'LIC-ZZ', id_number: '9001015009081' }),
      ],
    }))

    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/name, phone, licence/i), { target: { value: term } })

    expect(rowNames()).toEqual(['Zane'])
  })

  it('filters by status', () => {
    mockedUseDrivers.mockReturnValue(driversState({
      drivers: [makeDriver('a', { full_name: 'Active One' }), makeDriver('b', { full_name: 'Inactive One', is_active: false })],
    }))

    renderPage()
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'inactive' } })
    expect(rowNames()).toEqual(['Inactive One'])

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'active' } })
    expect(rowNames()).toEqual(['Active One'])
  })

  it('shows placeholder rows on the first load and keeps rows during a refetch', () => {
    mockedUseDrivers.mockReturnValue(driversState({ isLoading: true }))
    const { unmount } = renderPage()
    expect(screen.getByText('Loading drivers')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    unmount()

    mockedUseDrivers.mockReturnValue(driversState({ isLoading: true, drivers: [makeDriver('a', { full_name: 'Stays' })] }))
    renderPage()
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'false')
    expect(rowNames()).toEqual(['Stays'])
  })

  it('shows the error with a retry, and toasts it', () => {
    const refetch = vi.fn()
    mockedUseDrivers.mockReturnValue(driversState({ error: 'Network unreachable', refetch }))

    renderPage()

    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    expect(screen.getByText('Network unreachable')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to load drivers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the empty state when nothing matches', () => {
    renderPage()

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('No drivers')).toBeInTheDocument()
    expect(screen.getByText('No drivers match your filters.')).toBeInTheDocument()
  })
})

describe('Add driver', () => {
  it('is offered to admins only', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /add driver/i })).toBeInTheDocument()
  })

  it('is hidden from other roles', () => {
    mockUser.current = { id: 'me', role: 'dispatcher' }

    renderPage()

    expect(screen.queryByRole('button', { name: /add driver/i })).toBeNull()
  })

  it('keeps Save disabled until the form is valid, then posts the normalised phone and refetches', async () => {
    const refetch = vi.fn()
    mockedUseDrivers.mockReturnValue(driversState({ refetch }))
    mockedPost.mockResolvedValue({})

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /add driver/i }))
    const save = screen.getByRole('button', { name: /save driver/i })
    expect(save).toBeDisabled()

    const type = (name: string, value: string) => fireEvent.change(document.querySelector(`[name="${name}"]`) as HTMLInputElement, { target: { value } })
    type('full_name', 'Thandi Nkosi')
    type('id_number', '8001015009087')
    type('phone_number', '0821234567')
    type('license_number', 'DRV-777')
    type('license_expiry', '2030-06-01')

    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1))
    expect(mockedPost).toHaveBeenCalledWith('/api/v1/drivers', expect.objectContaining({
      full_name: 'Thandi Nkosi',
      phone_number: '+27821234567',
      license_expiry: '2030-06-01',
    }))
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  })
})
