import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TripDetailPage from './page'
import { useTripDetail } from '@/lib/hooks/useTripDetail'
import { mockPrecincts, mockTrips, TRIP_0040_ID } from '@shared/lib/mocks'
import type { TripException } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'

const push = vi.fn()
const notify = vi.fn()
const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }))
const forensicMode = vi.hoisted(() => ({
  canViewForensics: true,
  forensicOn: true,
  toggle: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: TRIP_0040_ID }),
  useRouter: () => ({ push }),
  useSearchParams: () => navigation.search,
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
  useForensicMode: () => forensicMode,
}))

vi.mock('@/lib/hooks/useElementWidth', () => ({
  useElementWidth: () => ({ ref: vi.fn(), width: 0 }),
}))

vi.mock('@/lib/hooks/useResizablePanel', () => ({
  DETAIL_PANEL_MIN_W: 360,
  DETAIL_PANEL_MAX_W: 720,
  useResizablePanel: () => ({ width: 0, startResize: vi.fn() }),
}))

vi.mock('@/components/blockchain/VerifyButton', () => ({
  VerifyButton: ({ subjectType, subjectId, ariaLabel }: {
    subjectType: string; subjectId: string; ariaLabel?: string
  }) => (
    <span data-testid="verify-subject" aria-label={ariaLabel}>{subjectType}:{subjectId}</span>
  ),
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
  navigation.search = new URLSearchParams()
  forensicMode.canViewForensics = true
  forensicMode.forensicOn = true
  forensicMode.toggle.mockReset()
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
    fireEvent.click(within(loadingGroup).getByRole('button', { name: '2 exceptions · 0 need review' }))
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
    fireEvent.click(within(loadingGroup).getByRole('button', { name: '2 exceptions · 0 need review' }))
    const exceptionRows = within(loadingGroup).getAllByRole('group', {
      name: 'Exception linked to Loading phase',
    })

    expect(exceptionRows[0]).toHaveTextContent('Cargo Damage')
    expect(exceptionRows[1]).toHaveTextContent('Checkpoint Timeout')
  })

  it.each([
    ['departure', 'pickup'],
    ['confirmation', 'delivery'],
  ] as const)('attaches %s evidence verification to its phase-event subject', (phaseType, receiptType) => {
    const base = tripWithLoadingExceptionsOutOfOrder()
    const evidencePhase = base.phases.find(phase => phase.phase_type === phaseType)
    if (!evidencePhase) throw new Error(`${phaseType} phase fixture is missing`)
    const receiptId = `phase-receipt-${receiptType}`
    mockedUseTripDetail.mockReturnValue({
      trip: {
        ...base,
        phases: base.phases.map(phase => phase.phase_event_id === evidencePhase.phase_event_id
          ? { ...phase, blockchain_receipt_id: receiptId }
          : phase),
        blockchain_receipts: [...base.blockchain_receipts, {
          id: receiptId,
          subject_type: 'phase_event',
          subject_id: evidencePhase.phase_event_id,
          receipt_type: receiptType,
          data_hash: 'a'.repeat(64),
          hedera_topic_id: '0.0.12345',
          hedera_sequence_number: 7,
          hedera_consensus_timestamp: '2026-05-08T09:22:00Z',
          hedera_tx_id: null,
          created_at: '2026-05-08T09:22:00Z',
        }],
      },
      isLoading: false, isValidating: false, error: null,
      refetch: vi.fn(), refetchSilent: vi.fn(), errorStatus: null, lastUpdated: Date.now(),
    })

    render(<TripDetailPage />)

    const phaseGroup = screen.getByRole('group', { name: new RegExp(`^${phaseType} phase$`, 'i') })
    const verification = within(phaseGroup).getByTestId('verify-subject')
    expect(verification).toHaveTextContent(
      `phase_event:${evidencePhase.phase_event_id}`,
    )
    expect(verification).toHaveAttribute(
      'aria-label', `Verify integrity for ${phaseType[0].toUpperCase()}${phaseType.slice(1)} receipt, phase ${evidencePhase.sequence_number}`,
    )
  })

  it('does not offer evidence verification for a non-evidence phase receipt', () => {
    render(<TripDetailPage />)

    const creationGroup = screen.getByRole('group', { name: /^Trip Created phase$/i })
    expect(within(creationGroup).queryByTestId('verify-subject')).toBeNull()
  })

  it.each([
    ['forensic mode is off', true, false],
    ['the dispatcher is not an admin', false, true],
  ] as const)('hides evidence verification when %s', (_case, canViewForensics, forensicOn) => {
    const base = tripWithLoadingExceptionsOutOfOrder()
    const departure = base.phases.find(phase => phase.phase_type === 'departure')
    if (!departure) throw new Error('departure phase fixture is missing')
    const receiptId = 'phase-receipt-pickup'
    mockedUseTripDetail.mockReturnValue({
      trip: {
        ...base,
        phases: base.phases.map(phase => phase.phase_event_id === departure.phase_event_id
          ? { ...phase, blockchain_receipt_id: receiptId }
          : phase),
        blockchain_receipts: [...base.blockchain_receipts, {
          id: receiptId,
          subject_type: 'phase_event',
          subject_id: departure.phase_event_id,
          receipt_type: 'pickup',
          data_hash: 'a'.repeat(64),
          hedera_topic_id: '0.0.12345',
          hedera_sequence_number: 7,
          hedera_consensus_timestamp: '2026-05-08T09:22:00Z',
          hedera_tx_id: null,
          created_at: '2026-05-08T09:22:00Z',
        }],
      },
      isLoading: false, isValidating: false, error: null,
      refetch: vi.fn(), refetchSilent: vi.fn(), errorStatus: null, lastUpdated: Date.now(),
    })
    forensicMode.canViewForensics = canViewForensics
    forensicMode.forensicOn = forensicOn

    render(<TripDetailPage />)

    const departureGroup = screen.getByRole('group', { name: /^Departure phase$/i })
    expect(within(departureGroup).queryByTestId('verify-subject')).toBeNull()
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

describe('Trip detail hash-anchored phase scroll', () => {
  it('scrolls a #phase-<id> hash into view on load, without auto-expanding the row', () => {
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const loading = trip.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0040 loading phase is missing')

    // getBoundingClientRect is always zeroed in jsdom, which would make the scroll math
    // a silent no-op either way; stub it so the hash-anchored row and everything else
    // report distinguishable positions, the same way a real layout would.
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: this.id.startsWith('phase-') ? 250 : 0 } as DOMRect
    })
    window.location.hash = `#phase-${loading.phase_event_id}`

    try {
      const { container } = render(<TripDetailPage />)

      const scrollParent = container.querySelector<HTMLElement>('.overflow-y-auto')
      if (!scrollParent) throw new Error('timeline scroll container not found')
      expect(scrollParent.scrollTop).toBe(250)

      // Landing on the row is not the same as opening it: PhaseTimelineItem's own
      // toggle state is untouched, same as the "Jump to current phase" button.
      const loadingRow = screen.getByRole('group', { name: 'Loading phase and exceptions' })
      expect(within(loadingRow).getAllByRole('button', { expanded: false })[0]).toBeInTheDocument()
    } finally {
      window.location.hash = ''
      rectSpy.mockRestore()
    }
  })

  it('does not throw when the hash names a phase that is not on this trip', () => {
    window.location.hash = '#phase-does-not-exist'

    try {
      expect(() => render(<TripDetailPage />)).not.toThrow()
    } finally {
      window.location.hash = ''
    }
  })
})

describe('Trip detail summary and panels', () => {
  it('keeps the route summary visible and opens the exception panel', () => {
    render(<TripDetailPage />)
    expect(screen.getByRole('heading', { name: 'TRP-2026-0040' })).toBeInTheDocument()
    expect(screen.getByText('FedEx JHB → FedEx DBN')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Trip sections' })).getByRole('button', { name: /exceptions ·/i }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('panel=exceptions'), { scroll: false })
  })

  it('opens the information panel with a compact trip record', () => {
    render(<TripDetailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Trip information' }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('panel=information'), { scroll: false })
  })

  it('routes a phase group to the all-exceptions panel scope for that exact phase', () => {
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const loading = trip.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0040 loading phase is missing')
    render(<TripDetailPage />)

    const loadingGroup = screen.getByRole('group', { name: 'Loading phase and exceptions' })
    fireEvent.click(within(loadingGroup).getByRole('button', { name: 'View in panel' }))

    expect(push).toHaveBeenCalledWith(
      expect.stringContaining(`panel=exceptions&exceptions=all&phase=${loading.phase_event_id}`),
      { scroll: false },
    )
  })

  it('shows a recoverable invalid phase URL instead of another phase or trip record', () => {
    navigation.search = new URLSearchParams('panel=exceptions&exceptions=all&phase=foreign-phase')
    render(<TripDetailPage />)

    expect(screen.getByText('This phase filter is not part of this trip.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear phase filter' }))
    expect(push).toHaveBeenCalledWith(`/trips/${TRIP_0040_ID}?panel=exceptions&exceptions=all`, { scroll: false })
  })
})
