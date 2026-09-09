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

beforeEach(() => {
  push.mockReset()
  notify.mockReset()
  mockedUseTripDetail.mockReturnValue({
    trip: tripWithLoadingExceptionsOutOfOrder(),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    refetchSilent: vi.fn(),
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

describe('Trip detail header summary', () => {
  it('keeps the important trip summary visible and reveals the overview on hover', () => {
    vi.useFakeTimers()

    try {
      render(<TripDetailPage />)

      const summary = screen.getByRole('button', {
        name: 'Show trip overview for TRP-2026-0040',
      })
      expect(summary).toHaveTextContent('FX-ORD-2026-0040')
      expect(summary).toHaveTextContent('FedEx JHB → FedEx DBN')
      expect(summary).toHaveTextContent('Thabo Formby')
      expect(summary).toHaveTextContent('KZN 56-78 YP')
      expect(screen.queryByRole('region', { name: 'Trip overview' })).not.toBeInTheDocument()

      fireEvent.mouseEnter(summary)
      act(() => vi.advanceTimersByTime(150))

      const overview = screen.getByRole('region', { name: 'Trip overview' })
      expect(overview).toHaveTextContent('Linbro Park')
      expect(overview).toHaveTextContent('Riverhorse Valley')
      expect(overview).toHaveTextContent('+27825550002')
      expect(overview).toHaveTextContent('0 parcels booked')
      expect(overview).toHaveTextContent('Planned depart')
      expect(overview).toHaveTextContent('Planned arrival')
      expect(overview).not.toHaveTextContent('Actual depart')
      expect(overview).not.toHaveTextContent('Actual arrival')
      expect(overview).not.toHaveTextContent('Origin count')
      expect(overview).not.toHaveTextContent('Seal')
      expect(overview).not.toHaveTextContent('Blockchain')
      expect(overview).not.toHaveTextContent('Not recorded')

      fireEvent.mouseLeave(summary)
      fireEvent.mouseEnter(overview)
      act(() => vi.advanceTimersByTime(180))
      expect(screen.getByRole('region', { name: 'Trip overview' })).toBeInTheDocument()

      fireEvent.mouseLeave(overview)
      act(() => vi.advanceTimersByTime(180))
      expect(screen.queryByRole('region', { name: 'Trip overview' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens for keyboard focus and closes with Escape', () => {
    render(<TripDetailPage />)

    const summary = screen.getByRole('button', {
      name: 'Show trip overview for TRP-2026-0040',
    })

    fireEvent.focus(summary)
    expect(screen.getByRole('region', { name: 'Trip overview' })).toBeInTheDocument()

    fireEvent.keyDown(summary, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Trip overview' })).not.toBeInTheDocument()
  })
})
