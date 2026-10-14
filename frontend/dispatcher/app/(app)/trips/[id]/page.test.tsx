import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TripDetailPage from './page'
import { useTripDetail } from '@/lib/hooks/useTripDetail'
import { mockPrecincts, mockTrips, TRIP_0040_ID } from '@shared/lib/mocks'
import type { TripException } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'
import { line } from '@/components/domain/__tests__/textLine'

const push = vi.fn()
const replace = vi.fn()
const notify = vi.fn()
const navigation = vi.hoisted(() => ({ search: new URLSearchParams(), tripId: null as string | null }))
const artifactState = vi.hoisted(() => ({ error: null as string | null, refetch: vi.fn() }))
const forensicMode = vi.hoisted(() => ({
  canViewForensics: true,
  forensicOn: true,
  toggle: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: navigation.tripId ?? TRIP_0040_ID }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => navigation.search,
}))

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/hooks/useTripDetail', () => ({
  useTripDetail: vi.fn(),
}))

vi.mock('@/lib/api/auditPacks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auditPacks')>('@/lib/api/auditPacks')
  return { ...actual, listAuditPacks: vi.fn().mockResolvedValue([]), listIncidentDeclarations: vi.fn().mockResolvedValue([]) }
})

vi.mock('@/lib/hooks/usePrecincts', () => ({
  usePrecincts: () => ({ precincts: mockPrecincts, isLoading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTripArtifacts', () => ({
  useTripArtifacts: () => ({
    artifacts: [],
    byId: new Map(),
    isLoading: false,
    isValidating: false,
    error: artifactState.error,
    refetch: artifactState.refetch,
  }),
}))

// ExceptionSummary reads the signed-in user to word a claim as mine or a colleague's.
// Nothing this file asserts depends on who that is, so the identity is stubbed.
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-me' } }) }))

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

describe('Trip detail expanded timeline', () => {
  let restoreMedia: (() => void) | undefined
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
  afterEach(() => { restoreMedia?.(); restoreMedia = undefined })

  function desktop(): void {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ ...window.matchMedia(''), matches: true })
    restoreMedia = () => media.mockRestore()
  }

  it('expands and returns with the same timeline, scroller, view and selected record, keeping the title and the info panel', () => {
    desktop()
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const selected = trip.exceptions[0]
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&exception=${selected.id}`)
    render(<TripDetailPage />)
    const timeline = screen.getByRole('region', { name: 'Trip timeline' })
    const scroller = document.querySelector('[data-timeline-scroller]')
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!
    const facts = within(header).getByText('Driver').closest('.grid')!
    fireEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
    expect(timeline).toHaveClass('max-w-4xl')
    expect(facts).not.toHaveClass('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))
    expect(timeline).not.toHaveClass('max-w-4xl')
    // Only the facts grid collapses: the trip title stays, and so does the docked panel.
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
    expect(facts).toHaveClass('hidden')
    expect(screen.getByRole('complementary', { name: 'Trip detail' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Trip detail' }).querySelector(`[data-exception-id="${selected.id}"]`)).toHaveAttribute('aria-current', 'true')
    for (const name of ['Return to trip layout', 'Jump to current phase ↓']) {
      expect(within(timeline).getByRole('button', { name })).toHaveAttribute('data-keep-exception-selection')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Return to trip layout' }))
    expect(screen.getByRole('region', { name: 'Trip timeline' })).toBe(timeline)
    expect(document.querySelector('[data-timeline-scroller]')).toBe(scroller)
    expect(timeline).toHaveClass('max-w-4xl')
    expect(facts).not.toHaveClass('hidden')
    expect(screen.getByRole('tab', { name: 'Minimised' })).toHaveAttribute('aria-selected', 'true')
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('labels the expand control as an icon button that says what it does', () => {
    render(<TripDetailPage />)
    const expand = screen.getByRole('button', { name: 'Expand timeline' })
    expect(expand).toHaveAttribute('title', 'Expand timeline')
    expect(expand).toHaveTextContent('')
    expect(expand.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Return to trip layout' })).toHaveAttribute('title', 'Return to trip layout')
  })

  it('reveals a capped record from expanded Minimised through the docked panel and keeps the URL', async () => {
    desktop()
    const base = tripWithLoadingExceptionsOutOfOrder()
    const loading = base.phases.find(phase => phase.phase_type === 'loading')!
    const exceptions = Array.from({ length: 5 }, (_, index) => ({ ...base.exceptions[0], id: `expand-${index}` as TripException['id'],
      phase_event_id: loading.phase_event_id, review_status: 'needs_review' as const }))
    mockedUseTripDetail.mockReturnValue({ trip: { ...base, exceptions }, isLoading: false, isValidating: false,
      error: null, errorStatus: null, refetch: vi.fn(), refetchSilent: vi.fn(), lastUpdated: null })
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loading.phase_event_id}&exception=expand-4`)
    render(<TripDetailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
    const panel = screen.getByRole('complementary', { name: 'Trip detail' })
    fireEvent.click(within(panel.querySelector<HTMLElement>('[data-exception-id="expand-4"]')!).getByRole('button', { name: 'Show in timeline' }))
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'exception-row-expand-4'))
    expect(document.activeElement?.closest('[hidden]')).toBeNull()
    // Minimised only changes collapsed cards, so revealing a row opens its card and leaves the view alone.
    expect(screen.getByRole('tab', { name: 'Minimised' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('group', { name: 'Loading phase and exceptions' })).getByRole('button', { name: /^Loading/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('group', { name: /^Departure phase/ })).getByRole('button', { name: /^Departure/ })).toHaveAttribute('aria-expanded', 'false')
    expect(navigation.search.get('exception')).toBe('expand-4')
    expect(replace).not.toHaveBeenCalled()
  })

  it('keeps the top reading phase below the measured toolbar through view and layout changes, without repeating on refresh', async () => {
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      const timeline = document.querySelector('[aria-label="Trip timeline"]')
      const expanded = timeline && !timeline.classList.contains('max-w-4xl')
      const minimised = document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Minimised'
      const toolbarHeight = expanded ? 96 : 64
      let top = 20; let height = 800
      if (this.hasAttribute('data-timeline-toolbar')) height = toolbarHeight
      if (this.id.startsWith('phase-')) {
        const phases = [...document.querySelectorAll('[id^="phase-"]')]
        height = minimised ? expanded ? 100 : 120 : 200
        const scroll = document.querySelector('[data-timeline-scroller]')?.scrollTop ?? 0
        top = 20 + toolbarHeight + phases.indexOf(this) * height - scroll
      }
      return { top, bottom: top+height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON: () => ({}) }
    })
    try {
      const rendered = render(<TripDetailPage />)
      const scroller = document.querySelector('[data-timeline-scroller]')!
      scroller.scrollTop = 450
      fireEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
      await waitFor(() => expect(scroller.scrollTop).toBe(240))
      fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))
      await waitFor(() => expect(scroller.scrollTop).toBe(200))
      fireEvent.click(screen.getByRole('button', { name: 'Return to trip layout' }))
      await waitFor(() => expect(scroller.scrollTop).toBe(240))
      scroller.scrollTop = 73
      const state = mockedUseTripDetail.mock.results.at(-1)!.value as ReturnType<typeof useTripDetail>
      mockedUseTripDetail.mockReturnValue({ ...state, trip: { ...state.trip! }, lastUpdated: Date.now()+1 })
      rendered.rerender(<TripDetailPage />)
      expect(scroller.scrollTop).toBe(73)
    } finally { geometry.mockRestore() }
  })
})

describe('Trip detail Evidence and Minimised navigation', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
  function docked(): () => void {
    const query = window.matchMedia('')
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ ...query, matches: true })
    return () => media.mockRestore()
  }

  it('keeps the selected exception and URL through view round trips', async () => {
    const restore = docked()
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const selected = trip.exceptions[0]
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&exception=${selected.id}`)
    try {
      render(<TripDetailPage />)
      const timeline = screen.getByRole('region', { name: 'Trip timeline' })
      const scroller = document.querySelector('[data-timeline-scroller]')
      fireEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
      expect(document.querySelector(`[data-exception-id="${selected.id}"]`)).toHaveAttribute('aria-current', 'true')
      fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }))
      expect(screen.getByRole('region', { name: 'Trip timeline' })).toBe(timeline)
      expect(document.querySelector('[data-timeline-scroller]')).toBe(scroller)
      expect(push).not.toHaveBeenCalled()
      expect(replace).not.toHaveBeenCalled()
      expect(document.querySelector(`[data-exception-id="${selected.id}"]`)).toHaveAttribute('aria-current', 'true')
    } finally { restore() }
  })

  it('opens a different trip in Evidence instead of retaining the previous trip’s local view', () => {
    const rendered = render(<TripDetailPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
    const other = mockTrips[0]
    navigation.tripId = other.id
    mockedUseTripDetail.mockReturnValue({ trip: other, isLoading: false, isValidating: false, error: null, errorStatus: null, refetch: vi.fn(), refetchSilent: vi.fn(), lastUpdated: null })
    rendered.rerender(<TripDetailPage />)
    expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('closes the overlay before revealing a capped fifth exception, leaving the view as it was', async () => {
    const base = tripWithLoadingExceptionsOutOfOrder()
    const loading = base.phases.find(phase => phase.phase_type === 'loading')!
    const exceptions = Array.from({ length: 5 }, (_, index) => ({ ...base.exceptions[0],
      id: `mini-${index}` as TripException['id'], review_status: 'needs_review' as const, phase_event_id: loading.phase_event_id,
    }))
    const state = mockedUseTripDetail.mock.results.at(-1)?.value as ReturnType<typeof useTripDetail> | undefined
    mockedUseTripDetail.mockReturnValue({ ...(state ?? { isLoading: false, isValidating: false, error: null, errorStatus: null, refetch: vi.fn(), refetchSilent: vi.fn(), lastUpdated: null }), trip: { ...base, exceptions } })
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loading.phase_event_id}`)
    const rendered = render(<TripDetailPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
    const overlay = screen.getByRole('dialog', { name: 'Trip exceptions' })
    const record = overlay.querySelector<HTMLElement>('[data-exception-id="mini-4"]')!
    fireEvent.click(within(record).getByRole('button', { name: 'Show in timeline' }))
    expect(screen.getByRole('tab', { name: 'Minimised' })).toHaveAttribute('aria-selected', 'true')
    navigation.search = new URLSearchParams(push.mock.calls.at(-1)![0].split('?')[1])
    rendered.rerender(<TripDetailPage />)

    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'exception-row-mini-4'))
    expect(screen.queryByRole('dialog', { name: 'Trip exceptions' })).not.toBeInTheDocument()
    expect(document.activeElement?.closest('[hidden]')).toBeNull()
    expect(document.activeElement).toHaveAttribute('data-highlighted', 'true')
    expect(within(screen.getByRole('group', { name: 'Loading phase and exceptions' })).getByRole('button', { name: /^Loading/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('group', { name: /^Departure phase/ })).getByRole('button', { name: /^Departure/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('reveals a trip-level record from Minimised and handles another request for the same record', async () => {
    const restore = docked()
    const base = tripWithLoadingExceptionsOutOfOrder()
    const record = { ...base.exceptions[0], id: 'mini-trip' as TripException['id'], phase_event_id: null, exception_type: 'dispatcher_note' as const }
    mockedUseTripDetail.mockReturnValue({ trip: { ...base, exceptions: [record] }, isLoading: false, isValidating: false, error: null, errorStatus: null, refetch: vi.fn(), refetchSilent: vi.fn(), lastUpdated: null })
    navigation.search = new URLSearchParams('panel=exceptions&exceptions=all&exception=mini-trip')
    try {
      render(<TripDetailPage />)
      const panel = screen.getByRole('complementary', { name: 'Trip detail' })
      for (let request = 0; request < 2; request++) {
        fireEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
        expect(within(screen.getByRole('region', { name: 'Trip-level events' })).getByRole('button', { name: /Dispatcher Note|Note/i })).toBeInTheDocument()
        fireEvent.click(within(panel).getByRole('button', { name: 'Show in timeline' }))
        await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'exception-row-mini-trip'))
        expect(document.activeElement?.closest('[hidden]')).toBeNull()
      }
    } finally { restore() }
  })
})

it('shows a plain evidence-refresh error with Retry and logs the diagnostic URL', () => {
  artifactState.error = 'GET http://localhost:8000/api/v1/trips/x/artifacts failed'
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    render(<TripDetailPage />)
    expect(screen.getByText('Evidence could not be refreshed.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(artifactState.error)
    expect(logged).toHaveBeenCalledWith('Evidence could not be refreshed.', artifactState.error)
    fireEvent.click(within(screen.getByText('Evidence could not be refreshed.').closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Retry' }))
    expect(artifactState.refetch).toHaveBeenCalled()
  } finally {
    artifactState.error = null
    logged.mockRestore()
  }
})

describe('parcel search return navigation', () => {
  it('returns to the selected barcode and waybill', () => {
    const returnTo = '/parcels?barcode=000123%2Fa&waybill=WB-01'
    navigation.search.set('returnTo', returnTo)
    render(<TripDetailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(push).toHaveBeenCalledWith(returnTo)
  })

  it('rejects off-site return destinations', () => {
    navigation.search.set('returnTo', '//other.example/path')
    render(<TripDetailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(push).toHaveBeenCalledWith('/')
  })
})

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
  replace.mockReset()
  notify.mockReset()
  navigation.search = new URLSearchParams()
  navigation.tripId = null
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
  it('renders each exception as one row inside the phase group that recorded it', () => {
    render(<TripDetailPage />)

    const loadingGroup = screen.getByRole('group', { name: 'Loading phase and exceptions' })
    const rows = within(loadingGroup).getAllByRole('button', { name: /Cargo Damage|Checkpoint Timeout/ })

    // Collapsed, the rows sit under the verdict: an exception is never hidden behind a closed card.
    expect(rows).toHaveLength(2)
    expect(within(loadingGroup).getByRole('button', { name: /Loading/, expanded: false })).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('System recorded')
    expect(rows[0]).toHaveTextContent('Info')
    expect(loadingGroup.querySelector('article')).toBeNull()
  })

  it('orders a phase\'s exception rows from earliest to latest', () => {
    render(<TripDetailPage />)

    const loadingGroup = screen.getByRole('group', { name: 'Loading phase and exceptions' })
    const rows = within(loadingGroup).getAllByRole('button', { name: /Cargo Damage|Checkpoint Timeout/ })

    expect(rows[0]).toHaveTextContent('Cargo Damage')
    expect(rows[1]).toHaveTextContent('Checkpoint Timeout')
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
        // The Audit trail belongs to a resolved phase: nothing is anchored before one completes.
        phases: base.phases.map(phase => phase.phase_event_id === evidencePhase.phase_event_id
          ? { ...phase, blockchain_receipt_id: receiptId, status: 'completed' as const, completed_at: phase.completed_at ?? '2026-05-09T17:00:00Z' }
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
    // The receipt and Verify live in the card's Audit trail, so the card is opened first.
    fireEvent.click(within(phaseGroup).getByRole('button', { name: new RegExp(`^${phaseType}`, 'i'), expanded: false }))
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
    fireEvent.click(within(departureGroup).getByRole('button', { name: /^Departure/i, expanded: false }))
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
  // The exceptions panel scrolls a selected record into view; jsdom has no layout to do it.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('keeps the route summary visible and opens the exception panel', () => {
    render(<TripDetailPage />)
    expect(screen.getByRole('heading', { name: 'TRP-2026-0040' })).toBeInTheDocument()
    expect(screen.getAllByText('FedEx JHB → FedEx DBN')[0]).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Trip sections' })).getByRole('button', { name: /exceptions ·/i }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('panel=exceptions'), { scroll: false })
  })

  it('opens the information panel with a compact trip record', () => {
    render(<TripDetailPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Info' }))
    expect(push).toHaveBeenCalledWith(expect.stringContaining('panel=information'), { scroll: false })
  })

  it('opens the exceptions panel on the exact record when its row on the timeline is clicked', () => {
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const loading = trip.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0040 loading phase is missing')
    const earlierId = trip.exceptions.find(exception => exception.exception_type === 'cargo_damage')!.id
    render(<TripDetailPage />)

    const loadingGroup = screen.getByRole('group', { name: 'Loading phase and exceptions' })
    fireEvent.click(within(loadingGroup).getByRole('button', { name: /Cargo Damage/ }))

    // The record's id AND its phase: a phase-scoped view with that one record selected.
    expect(push).toHaveBeenCalledWith(
      `/trips/${TRIP_0040_ID}?panel=exceptions&exceptions=all&phase=${loading.phase_event_id}&exception=${earlierId}`,
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

  it('forces a valid phase URL to all recorded exceptions even after browser navigation restores a narrow filter', () => {
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const loading = trip.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0040 loading phase is missing')
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loading.phase_event_id}`)

    const rendered = render(<TripDetailPage />)

    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=needs_review&phase=${loading.phase_event_id}`)
    rendered.rerender(<TripDetailPage />)

    // This rerender models browser Back/Forward restoring an older query string.
    const allRecorded = screen.getByRole('button', { name: 'All recorded · 2' })
    expect(allRecorded).toHaveStyle({ background: 'linear-gradient(135deg,#1b1b1c 0%,#303031 100%)' })
  })

  it('closes the narrow overlay before revealing the exception row in the timeline, then focuses that row', async () => {
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const loading = trip.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0040 loading phase is missing')
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loading.phase_event_id}`)
    const rendered = render(<TripDetailPage />)

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Trip exceptions' })).getAllByRole('button', { name: 'Show in timeline' })[0]!)
    expect(push).toHaveBeenCalledWith(`/trips/${TRIP_0040_ID}?exceptions=all`, { scroll: false })

    navigation.search = new URLSearchParams('exceptions=all')
    rendered.rerender(<TripDetailPage />)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trip exceptions' })).not.toBeInTheDocument())
    const loadingGroup = screen.getByRole('group', { name: 'Loading phase and exceptions' })
    await waitFor(() => expect(within(loadingGroup).getByRole('button', { name: /Loading/, expanded: true })).toBeInTheDocument())
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-highlighted', 'true'))
    expect(loadingGroup).toContainElement(document.activeElement as HTMLElement)
  })

  it('keeps the docked panel open while revealing the exception row in the timeline', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, media: '(min-width: 1280px)', onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const loading = trip.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0040 loading phase is missing')
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loading.phase_event_id}`)

    try {
      render(<TripDetailPage />)
      const panel = screen.getByRole('complementary', { name: 'Trip detail' })
      fireEvent.click(within(panel).getAllByRole('button', { name: 'Show in timeline' })[0]!)

      expect(panel).toBeInTheDocument()
      const loadingGroup = screen.getByRole('group', { name: 'Loading phase and exceptions' })
      await waitFor(() => expect(within(loadingGroup).getByRole('button', { name: /Loading/, expanded: true })).toBeInTheDocument())
      await waitFor(() => expect(loadingGroup).toContainElement(document.activeElement as HTMLElement))
      expect(document.activeElement).toHaveAttribute('data-highlighted', 'true')
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('reveals a trip-level exception in the "Trip record" list from the panel', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, media: '(min-width: 1280px)', onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })
    const base = tripWithLoadingExceptionsOutOfOrder()
    const tripLevel: TripException = { ...base.exceptions[0]!, id: 'trip-level-exception' as TripException['id'], phase_event_id: null, exception_type: 'dispatcher_note' }
    mockedUseTripDetail.mockReturnValue({
      trip: { ...base, exceptions: [tripLevel] }, isLoading: false, isValidating: false, error: null,
      refetch: vi.fn(), refetchSilent: vi.fn(), errorStatus: null, lastUpdated: Date.now(),
    })
    navigation.search = new URLSearchParams('panel=exceptions&exceptions=all&exception=trip-level-exception')

    try {
      render(<TripDetailPage />)
      fireEvent.click(within(screen.getByRole('complementary', { name: 'Trip detail' })).getByRole('button', { name: 'Show in timeline' }))

      const record = screen.getByRole('region', { name: 'Trip-level events' })
      await waitFor(() => expect(record).toContainElement(document.activeElement as HTMLElement))
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it('returns focus to the row that opened the overlay when the overlay closes', async () => {
    const trip = tripWithLoadingExceptionsOutOfOrder()
    const loading = trip.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0040 loading phase is missing')
    const earlierId = trip.exceptions.find(exception => exception.exception_type === 'cargo_damage')!.id
    const rendered = render(<TripDetailPage />)
    const row = within(screen.getByRole('group', { name: 'Loading phase and exceptions' })).getByRole('button', { name: /Cargo Damage/ })
    row.focus()
    fireEvent.click(row)

    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loading.phase_event_id}&exception=${earlierId}`)
    rendered.rerender(<TripDetailPage />)
    expect(screen.getByRole('dialog', { name: 'Trip exceptions' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Trip exceptions' })).getByRole('button', { name: 'Close modal' }))
    expect(push).toHaveBeenLastCalledWith(`/trips/${TRIP_0040_ID}?exceptions=all`, { scroll: false })

    navigation.search = new URLSearchParams('exceptions=all')
    rendered.rerender(<TripDetailPage />)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trip exceptions' })).not.toBeInTheDocument())
    expect(row).toHaveFocus()
  })
})

describe('Trip detail legacy audit navigation', () => {
  it.each([false, true])('opens legacy audit links inside Info and scrolls its own surface once (docked=%s)', async docked => {
    const originalMedia = window.matchMedia('')
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ ...originalMedia, matches: docked })
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.id === 'trip-audit-packs' ? 480 : 20, left: 0, right: 400, bottom: 800, width: 400, height: 780, x: 0, y: 20, toJSON: () => ({}) }
    })
    try {
      navigation.search = new URLSearchParams('panel=audit')
      const rendered = render(<TripDetailPage />)
      const surface = docked ? within(screen.getByRole('complementary', { name: 'Trip detail' })).getByRole('tabpanel') : screen.getByRole('dialog', { name: 'Trip information' })
      expect(screen.getByRole('heading', { name: 'Custody' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Audit packs' })).toBeInTheDocument()
      await waitFor(() => expect(surface.scrollTop).toBe(460))
      const timeline = document.querySelector('[data-timeline-scroller]')!
      expect(timeline.scrollTop).toBe(0)

      surface.scrollTop = 125
      const state = mockedUseTripDetail.mock.results.at(-1)!.value as ReturnType<typeof useTripDetail>
      mockedUseTripDetail.mockReturnValue({ ...state, trip: { ...state.trip! }, lastUpdated: Date.now() + 1 })
      rendered.rerender(<TripDetailPage />)
      expect(surface.scrollTop).toBe(125)
    } finally { media.mockRestore(); geometry.mockRestore() }
  })

  it('opens ordinary Info at the top with no audit landing scroll', async () => {
    navigation.search = new URLSearchParams('panel=information')
    render(<TripDetailPage />)
    await screen.findByText('No audit packs issued for this trip yet.')
    expect(screen.getByRole('dialog', { name: 'Trip information' }).scrollTop).toBe(0)
    expect(screen.getByRole('heading', { name: 'Custody' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Audit packs' })).toBeInTheDocument()
  })
})

describe('Trip detail exceptions panel opened on one exception', () => {
  const EARLIER_ID = `${mockTrips.find(candidate => candidate.id === TRIP_0040_ID)!.exceptions[0]!.id}-earlier`
  const scrollIntoView = vi.fn()

  function dockedMatchMedia(): () => void {
    const original = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, media: '(min-width: 1280px)', onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })
    return () => { window.matchMedia = original }
  }
  function selectedRecord(): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-exception-id="${EARLIER_ID}"]`)
  }
  function loadingPhaseId(): string {
    return tripWithLoadingExceptionsOutOfOrder().phases.find(phase => phase.phase_type === 'loading')!.phase_event_id
  }

  beforeEach(() => {
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  it('raises the overlay on the selected record when the width is below the dock, and again after a reload of the same URL', async () => {
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&exception=${EARLIER_ID}`)

    const first = render(<TripDetailPage />)

    const dialog = screen.getByRole('dialog', { name: 'Trip exceptions' })
    expect(within(dialog).queryByRole('complementary')).toBeNull()
    expect(selectedRecord()).toHaveAttribute('aria-current', 'true')
    expect(dialog).toContainElement(selectedRecord())
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce())

    // A reload is a fresh mount of the same URL: it must land on the same record.
    first.unmount()
    scrollIntoView.mockReset()
    render(<TripDetailPage />)
    expect(selectedRecord()).toHaveAttribute('aria-current', 'true')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce())
  })

  it('selects the record inside the docked panel at 1280 px and wider', async () => {
    const restore = dockedMatchMedia()
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&exception=${EARLIER_ID}`)

    try {
      render(<TripDetailPage />)

      const panel = screen.getByRole('complementary', { name: 'Trip detail' })
      expect(panel).toContainElement(selectedRecord())
      expect(selectedRecord()).toHaveAttribute('aria-current', 'true')
      expect(screen.queryByRole('dialog', { name: 'Trip exceptions' })).toBeNull()
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce())
    } finally {
      restore()
    }
  })

  it.each([false, true])('deselects on an outside click while keeping the panel and phase filter (docked: %s)', docked => {
    const restore = docked ? dockedMatchMedia() : () => undefined
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loadingPhaseId()}&exception=${EARLIER_ID}`)
    try {
      const { rerender } = render(<TripDetailPage />)
      fireEvent.click(screen.getByRole('heading', { name: 'Trip timeline' }))

      expect(replace).toHaveBeenCalledOnce()
      expect(replace).toHaveBeenCalledWith(`/trips/${TRIP_0040_ID}?panel=exceptions&exceptions=all&phase=${loadingPhaseId()}`, { scroll: false })
      navigation.search.delete('exception')
      rerender(<TripDetailPage />)
      expect(document.querySelector('[aria-current="true"]')).toBeNull()
      expect(selectedRecord()?.querySelector('article')).not.toHaveClass('ring-2')
      expect(screen.getByText(line('Selected phase · 2 of 2 trip exceptions'))).toBeInTheDocument()
    } finally { restore() }
  })

  it('keeps selection when clicking inside its panel record', () => {
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&exception=${EARLIER_ID}`)
    render(<TripDetailPage />)
    fireEvent.click(within(selectedRecord()!).getByRole('heading', { name: 'Cargo Damage' }))

    expect(replace).not.toHaveBeenCalled()
    expect(selectedRecord()).toHaveAttribute('aria-current', 'true')
  })

  it('selects another timeline exception without an intervening deselection', () => {
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&exception=${EARLIER_ID}`)
    render(<TripDetailPage />)
    const loading = screen.getByRole('group', { name: 'Loading phase and exceptions' })
    fireEvent.click(within(loading).getByRole('button', { name: /Checkpoint Timeout/ }))

    expect(replace).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith(expect.stringContaining('exception='), { scroll: false })
  })

  it('removes the outside-click listener when leaving the trip', () => {
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&exception=${EARLIER_ID}`)
    const { unmount } = render(<TripDetailPage />)
    unmount()
    fireEvent.click(document.body)

    expect(replace).not.toHaveBeenCalled()
  })

  it('opens on the record from an exception link alone, without a panel parameter', () => {
    navigation.search = new URLSearchParams(`exception=${EARLIER_ID}`)

    render(<TripDetailPage />)

    expect(screen.getByRole('dialog', { name: 'Trip exceptions' })).toBeInTheDocument()
    expect(selectedRecord()).toHaveAttribute('aria-current', 'true')
  })

  it('shows a reviewed record even when the stored filter is "needs review"', () => {
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=needs_review&exception=${EARLIER_ID}`)

    render(<TripDetailPage />)

    // Both fixture exceptions are already past review, so the narrow filter alone would show none.
    expect(selectedRecord()).toBeInTheDocument()
  })

  it('opens a trip-level exception with no phase filter', () => {
    const base = tripWithLoadingExceptionsOutOfOrder()
    const tripLevel: TripException = { ...base.exceptions[0]!, id: 'trip-level-exception' as TripException['id'], phase_event_id: null }
    mockedUseTripDetail.mockReturnValue({
      trip: { ...base, exceptions: [...base.exceptions, tripLevel] }, isLoading: false, isValidating: false, error: null,
      refetch: vi.fn(), refetchSilent: vi.fn(), errorStatus: null, lastUpdated: Date.now(),
    })
    navigation.search = new URLSearchParams('panel=exceptions&exceptions=all&exception=trip-level-exception')

    render(<TripDetailPage />)

    expect(document.querySelector('[data-exception-id="trip-level-exception"]')).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByText(/^Selected phase/)).toBeNull()
    expect(screen.getByRole('button', { name: 'All recorded · 3' })).toBeInTheDocument()
  })

  it('keeps the phase filter and marks the record when both are in the URL', () => {
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loadingPhaseId()}&exception=${EARLIER_ID}`)

    render(<TripDetailPage />)

    expect(screen.getByText(line('Selected phase · 2 of 2 trip exceptions'))).toBeInTheDocument()
    expect(selectedRecord()).toHaveAttribute('aria-current', 'true')
  })

  it('shows a recoverable message for an exception id that is not on this trip', () => {
    navigation.search = new URLSearchParams('panel=exceptions&exceptions=all&exception=foreign-exception')

    render(<TripDetailPage />)

    expect(screen.getByText('This exception is not part of this trip.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cargo Damage' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all exceptions' }))
    expect(push).toHaveBeenCalledWith(`/trips/${TRIP_0040_ID}?panel=exceptions&exceptions=all`, { scroll: false })
  })

  it('clears the selected record when the phase filter control is clicked', () => {
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&phase=${loadingPhaseId()}&exception=${EARLIER_ID}`)
    render(<TripDetailPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear phase filter' }))

    expect(push).toHaveBeenCalledWith(`/trips/${TRIP_0040_ID}?panel=exceptions&exceptions=all`, { scroll: false })
  })

  it('leaves the single-record view when a reader picks a filter', () => {
    navigation.search = new URLSearchParams(`panel=exceptions&exceptions=all&exception=${EARLIER_ID}`)
    render(<TripDetailPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Unreviewed · 0' }))

    expect(push).toHaveBeenCalledWith(`/trips/${TRIP_0040_ID}?panel=exceptions&exceptions=needs_review`, { scroll: false })
  })

  it('routes "+n more" to the phase-scoped panel with no exception selected', () => {
    const base = tripWithLoadingExceptionsOutOfOrder()
    const phaseId = loadingPhaseId()
    const many = Array.from({ length: 4 }, (_unused, index) => ({
      ...base.exceptions[0]!, id: `more-${index}` as TripException['id'], phase_event_id: phaseId, review_status: 'needs_review' as const,
    }))
    mockedUseTripDetail.mockReturnValue({
      trip: { ...base, exceptions: many }, isLoading: false, isValidating: false, error: null,
      refetch: vi.fn(), refetchSilent: vi.fn(), errorStatus: null, lastUpdated: Date.now(),
    })
    render(<TripDetailPage />)
    const loadingGroup = screen.getByRole('group', { name: 'Loading phase and exceptions' })

    fireEvent.click(within(loadingGroup).getByRole('button', { name: /\+1 more/ }))

    expect(push).toHaveBeenCalledWith(`/trips/${TRIP_0040_ID}?panel=exceptions&exceptions=all&phase=${phaseId}`, { scroll: false })
  })
})
