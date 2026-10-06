import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PrecinctsPage from './page'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import type { UsePrecincts } from '@/lib/hooks/usePrecincts'
import type { Precinct } from '@shared/lib/types/precinct'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'admin_dispatcher', organization_id: 'org-1' } }),
}))

const notify = vi.fn()
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify }),
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

vi.mock('@/lib/hooks/usePrecincts', () => ({ usePrecincts: vi.fn() }))

// The thumbnail fetches map tiles, which is not what these tests are about.
vi.mock('@/components/map/StaticGeofenceThumbnail', () => ({
  StaticGeofenceThumbnail: () => null,
}))

const mockedUsePrecincts = vi.mocked(usePrecincts)

function makePrecinct(id: string, overrides: Partial<Precinct> = {}): Precinct {
  return {
    id: id as Precinct['id'],
    name: `Depot ${id}`,
    principal_organization_id: 'org-1',
    address: null,
    latitude: -33.9,
    longitude: 18.4,
    geofence_radius_metres: 100,
    is_shared: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as Precinct
}

function precinctsState(precincts: Precinct[] = [], overrides: Partial<UsePrecincts> = {}): UsePrecincts {
  return { precincts, isLoading: false, error: null, refetch: vi.fn(), ...overrides }
}

function renderPage() {
  return render(<ForensicModeProvider><PrecinctsPage /></ForensicModeProvider>)
}

beforeEach(() => {
  push.mockReset()
  notify.mockReset()
  mockedUsePrecincts.mockReset().mockReturnValue(precinctsState())
})

describe('Precincts list — loading', () => {
  it('shows placeholder cards while the first load is in flight, with the controls already usable', () => {
    mockedUsePrecincts.mockReturnValue(precinctsState([], { isLoading: true }))

    renderPage()

    expect(screen.getByRole('status', { name: 'Loading precincts' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: /add precinct/i })).toBeInTheDocument()
    expect(screen.queryByText('No precincts')).toBeNull()
  })

  it('replaces the placeholders with the real cards once they arrive', () => {
    mockedUsePrecincts.mockReturnValue(precinctsState([makePrecinct('a'), makePrecinct('b')]))

    renderPage()

    expect(screen.queryByRole('status', { name: 'Loading precincts' })).toBeNull()
    expect(screen.getByText('Depot a')).toBeInTheDocument()
    expect(screen.getByText('Depot b')).toBeInTheDocument()
  })

  it('keeps the cards on screen during a refetch instead of flashing the placeholders', () => {
    mockedUsePrecincts.mockReturnValue(precinctsState([makePrecinct('a')], { isLoading: true }))

    renderPage()

    expect(screen.queryByRole('status', { name: 'Loading precincts' })).toBeNull()
    expect(screen.getByText('Depot a')).toBeInTheDocument()
  })
})

describe('Precincts list', () => {
  it('opens a precinct from its card', () => {
    mockedUsePrecincts.mockReturnValue(precinctsState([makePrecinct('a')]))

    renderPage()
    fireEvent.click(screen.getByText('Depot a'))

    expect(push).toHaveBeenCalledWith('/precincts/a')
  })

  it('shows the error with a retry, and toasts it', () => {
    const refetch = vi.fn()
    mockedUsePrecincts.mockReturnValue(precinctsState([], { error: 'Network unreachable', refetch }))

    renderPage()

    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to load precincts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says there are no precincts when none are mapped', () => {
    renderPage()

    expect(screen.getByText('No precincts')).toBeInTheDocument()
  })
})
