import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TripDetailPage from './page'
import { useTripDetail } from '@/lib/hooks/useTripDetail'
import { mockPrecincts, mockTrips, TRIP_0040_ID } from '@shared/lib/mocks'
import type { TripException } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'

const push = vi.fn()
const notify = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: TRIP_0040_ID }),
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useTripDetail', () => ({
  useTripDetail: vi.fn(),
}))

vi.mock('@/lib/hooks/usePrecincts', () => ({
  usePrecincts: () => ({ precincts: mockPrecincts, isLoading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTripArtifacts', () => ({
  useTripArtifacts: () => ({
    artifacts: [],
    byId: new Map(),
    isLoading: false,
    isValidating: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify }),
}))

vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

vi.mock('@/lib/hooks/useElementWidth', () => ({
  useElementWidth: () => ({ ref: vi.fn(), width: 0 }),
}))

vi.mock('@/lib/hooks/useResizablePanel', () => ({
  DETAIL_PANEL_MIN_W: 360,
  DETAIL_PANEL_MAX_W: 720,
  useResizablePanel: () => ({ width: 0, startResize: vi.fn() }),
}))

vi.mock('@/components/blockchain/ForensicOnly', () => ({
  ForensicOnly: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/components/blockchain/VerifyButton', () => ({
  VerifyButton: () => null,
}))

const mockedUseTripDetail = vi.mocked(useTripDetail)

function tripWithLoadingExceptionsOutOfOrder(): Trip {
  const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)
  if (!trip) throw new Error('TRIP_0040 fixture is missing')

  const loading = trip.phases.find(phase => phase.phase_type === 'loading')
  if (!loading) throw new Error('TRIP_0040 loading phase is missing')

  const exception = trip.exceptions[0]
  if (!exception) throw new Error('TRIP_0040 exception fixture is missing')

  const laterException: TripException = {
    ...exception,
    id: `${exception.id}-later` as TripException['id'],
    exception_type: 'checkpoint_timeout',
    phase_event_id: loading.phase_event_id,
    created_at: '2026-05-09T13:00:00Z',
  }
  const earlierException: TripException = {
    ...exception,
    id: `${exception.id}-earlier` as TripException['id'],
    exception_type: 'cargo_damage',
    phase_event_id: loading.phase_event_id,
    created_at: '2026-05-09T12:00:00Z',
  }

  return {
    ...trip,
    // Deliberately newest-first: the page, not fixture insertion order, owns the
    // chronological presentation contract.
    exceptions: [laterException, earlierException],
  }
}

/** A trip stopped mid-drive: departure done, in_transit the lowest unresolved row. */
function tripDriving(): Trip {
  const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)
  if (!trip) throw new Error('TRIP_0040 fixture is missing')

  const ordered = [...trip.phases].sort((a, b) => a.sequence_number - b.sequence_number)
  const transit = ordered.find(phase => phase.phase_type === 'in_transit')
  if (!transit) throw new Error('TRIP_0040 in_transit phase is missing')

  return {
    ...trip,
    status: 'active',
    exceptions: [],
    phases: ordered.map(phase =>
      phase.sequence_number < transit.sequence_number
        ? { ...phase, status: 'completed' as const }
        : { ...phase, status: 'pending' as const, completed_at: null }),
  }
}

beforeEach(() => {
  push.mockReset()
  notify.mockReset()
  mockedUseTripDetail.mockReturnValue({
    trip: tripWithLoadingExceptionsOutOfOrder(),
    isLoading: false,
    isValidating: false,
    error: null,
    refetch: vi.fn(),
    refetchSilent: vi.fn(),
    errorStatus: null,
    lastUpdated: Date.now(),
  })
})

describe('Trip detail phase timeline', () => {
  it('renders exceptions inside the phase group that recorded them', () => {
    render(<TripDetailPage />)

    const loadingGroup = screen.getByRole('group', {
      name: 'Loading phase and exceptions',
    })
    const exceptionRows = within(loadingGroup).getAllByRole('group', {
      name: 'Exception linked to Loading phase',
    })

    expect(exceptionRows).toHaveLength(2)
    expect(exceptionRows[0]).toHaveAttribute('data-timeline-kind', 'exception')
    expect(exceptionRows[0]).toHaveTextContent('Loading · Exception')
    expect(exceptionRows[0]).toHaveTextContent('System')
    expect(exceptionRows[0]).toHaveTextContent('Info')
  })

  it('orders a phase exception stack from earliest to latest', () => {
    render(<TripDetailPage />)

    const loadingGroup = screen.getByRole('group', {
      name: 'Loading phase and exceptions',
    })
    const exceptionRows = within(loadingGroup).getAllByRole('group', {
      name: 'Exception linked to Loading phase',
    })

    expect(exceptionRows[0]).toHaveTextContent('Cargo Damage')
    expect(exceptionRows[1]).toHaveTextContent('Checkpoint Timeout')
  })
})

describe('Trip detail in-transit disclosure', () => {
  it('keeps the journey open with no toggle while the truck is driving', () => {
    mockedUseTripDetail.mockReturnValue({
      trip: tripDriving(), isLoading: false, isValidating: false, error: null,
      refetch: vi.fn(), refetchSilent: vi.fn(), errorStatus: null, lastUpdated: Date.now(),
    })
    render(<TripDetailPage />)

    const inTransit = screen.getByRole('group', { name: /In Transit phase/i })

    // No disclosure at all: the drive is the live part of the page, so there is nothing
    // to open and therefore no chevron to suggest something is hidden.
    expect(within(inTransit).queryByRole('button', { expanded: false })).toBeNull()
    expect(within(inTransit).queryByRole('button', { expanded: true })).toBeNull()
  })

  it('leaves a completed phase collapsed behind its own toggle', () => {
    mockedUseTripDetail.mockReturnValue({
      trip: tripDriving(), isLoading: false, isValidating: false, error: null,
      refetch: vi.fn(), refetchSilent: vi.fn(), errorStatus: null, lastUpdated: Date.now(),
    })
    render(<TripDetailPage />)

    const loading = screen.getByRole('group', { name: /^Loading phase$/i })

    expect(within(loading).getByRole('button', { expanded: false })).toBeInTheDocument()
  })
})

describe('Trip detail summary and panels', () => {
  it('keeps the route summary visible and opens the exception panel', () => {
    render(<TripDetailPage />)
    expect(screen.getByRole('heading', { name: 'TRP-2026-0040' })).toBeInTheDocument()
    expect(screen.getByText('FedEx JHB → FedEx DBN')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /exceptions ·/i }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('panel=exceptions'), { scroll: false })
  })

  it('opens the information panel with a compact trip record', () => {
    render(<TripDetailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Trip information' }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('panel=information'), { scroll: false })
  })
})
