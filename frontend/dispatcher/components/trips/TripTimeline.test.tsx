import { act, render, screen, within, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TripTimeline } from './TripTimeline'
import { VIEW_ON_MAP_LABEL } from '@/components/domain/LocationEvidencePanel'
import { makePhase } from '@/components/domain/__tests__/testFixtures'
import { mockPrecincts, mockTrips, PRECINCT_FEDEX_JHB_ID, PRECINCT_FEDEX_DBN_ID, TRIP_0035_ID, TRIP_0041_ID, TRIP_0043_ID } from '@shared/lib/mocks'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { ExceptionId, TripException } from '@shared/lib/types/exception'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'
import type { Trip, TripStop } from '@shared/lib/types/trip'

// PhaseEvidence's collapsed-content chain eventually reaches PhaseOverrideAction, which
// imports lib/api/client -> lib/supabase/client, and that module calls createClient() at
// import time; it throws without a real Supabase URL. Mocked the same way
// app/(app)/trips/[id]/page.test.tsx isolates itself, since these tests never open a row
// (the summary chip is asserted collapsed) but the import still resolves eagerly.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// ForensicOnly needs a real ForensicModeProvider (itself gated on useAuth) to render at
// all: mocked at the module boundary the same way every other domain detail-panel suite
// isolates itself, since this file is about the summary chip, not forensic-mode plumbing.
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

// The `driving` (alwaysOpen) in-transit row renders PhaseEvidence unconditionally —
// including PhaseOverrideAction, which calls useToast() — even though this suite never
// opens the override modal. Mocked the same way the trip detail page's own test suite
// isolates it, since a real ToastProvider is not what this file is about.
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}))

const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

const evidence = {
  artifactsById: NO_ARTIFACTS,
  artifactLoading: false,
  artifactError: null,
  onRetryArtifacts: vi.fn(),
  onChanged: vi.fn(),
}

function tripFor(id: typeof TRIP_0035_ID | typeof TRIP_0041_ID | typeof TRIP_0043_ID): Trip {
  const trip = mockTrips.find(candidate => candidate.id === id)
  if (!trip) throw new Error(`fixture ${id} is missing`)
  return trip
}

function phaseRow(phaseName: string) {
  return within(screen.getByRole('group', { name: `${phaseName} phase` }))
}

// Matches the row whether or not it currently carries an "and exceptions" suffix —
// several tests below deliberately attach a phase-scoped exception to a row whose
// other tests assert on it bare.
function phaseGroupElement(phaseName: string): HTMLElement {
  return screen.getByRole('group', { name: new RegExp(`^${phaseName} phase`) })
}

function makeTransitException(overrides: Partial<TripException> & Pick<TripException, 'id' | 'phase_event_id' | 'severity'>): TripException {
  return {
    trip_id: 'trip-1',
    exception_type: 'route_deviation',
    source: 'system',
    description: 'Vehicle deviated from the planned route.',
    checkpoint_id: null,
    supporting_artifact_id: null,
    review_status: 'recorded',
    review_outcome: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_note: null,
    contact_method: null,
    vehicle_id: null,
    merkle_batch_id: null,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

/** A synthetic 3-stop cross-dock trip: two in_transit legs, the second leg landing
 *  back at the SAME precinct the first leg departed from (a repeated stop). Exists to
 *  prove legs are told apart by phase_event_id, never by name — the house rule this
 *  task's brief calls out explicitly. */
function crossDockTrip(): Trip {
  const base = tripFor(TRIP_0035_ID)
  const originStopId = 'cd-stop-origin'
  const midStopId = 'cd-stop-mid'
  const backStopId = 'cd-stop-back'
  const stops: TripStop[] = [
    { id: originStopId, trip_id: base.id, precinct_id: PRECINCT_FEDEX_JHB_ID, sequence: 0, slot_time: null, notes: null, created_at: base.created_at, updated_at: base.created_at },
    { id: midStopId, trip_id: base.id, precinct_id: PRECINCT_FEDEX_DBN_ID, sequence: 1, slot_time: null, notes: null, created_at: base.created_at, updated_at: base.created_at },
    { id: backStopId, trip_id: base.id, precinct_id: PRECINCT_FEDEX_JHB_ID, sequence: 2, slot_time: null, notes: null, created_at: base.created_at, updated_at: base.created_at },
  ]

  const leg1Id = 'cd-leg-1' as PhaseEventId
  const leg2Id = 'cd-leg-2' as PhaseEventId
  const at = '2026-01-01T00:00:00Z'
  const completed = (phaseType: PhaseDescriptor['phase_type'], phaseEventId: PhaseEventId, sequence: number, stopId: string, completedAt: string): PhaseDescriptor =>
    makePhase(phaseType, { phase_event_id: phaseEventId, sequence_number: sequence, trip_stop_id: stopId, status: 'completed', completed_at: completedAt })

  const phases: PhaseDescriptor[] = [
    completed('trip_creation', 'cd-p0' as PhaseEventId, 0, originStopId, at),
    completed('activation', 'cd-p1' as PhaseEventId, 1, originStopId, at),
    completed('loading', 'cd-p2' as PhaseEventId, 2, originStopId, at),
    completed('departure', 'cd-p3' as PhaseEventId, 3, originStopId, at),
    completed('in_transit', leg1Id, 4, originStopId, at),
    completed('unloading', 'cd-p5' as PhaseEventId, 5, midStopId, at),
    completed('loading', 'cd-p6' as PhaseEventId, 6, midStopId, at),
    completed('departure', 'cd-p7' as PhaseEventId, 7, midStopId, at),
    completed('in_transit', leg2Id, 8, midStopId, at),
    completed('unloading', 'cd-p9' as PhaseEventId, 9, backStopId, at),
    completed('confirmation', 'cd-p10' as PhaseEventId, 10, backStopId, at),
  ]

  const leg1Exception = makeTransitException({ id: 'exc-leg1' as ExceptionId, phase_event_id: leg1Id, severity: 'critical' })
  const leg2Exception = makeTransitException({ id: 'exc-leg2' as ExceptionId, phase_event_id: leg2Id, severity: 'warning' })

  return {
    ...base,
    stops,
    phases,
    status: 'closed',
    exceptions: [leg1Exception, leg2Exception],
  }
}

describe('TripTimeline: compact location verdict', () => {
  // TRP-2026-0035 is closed with every phase walked through to completed: a stable base
  // for asserting on a `done` node's summary row without any card being expanded (closed
  // trips never auto-open a row: initialOpen requires an active phase, and a terminal
  // trip has none).
  it('shows the stored-verdict chip on a completed activation row, visible WITHOUT expanding the card', () => {
    const base = tripFor(TRIP_0035_ID)
    const trip: Trip = {
      ...base,
      phases: base.phases.map(p => p.phase_type === 'activation' ? { ...p, pulsit_geofence_confirmed: true } : p),
    }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    // Asserted before any click: the chip must already be in the document as rendered.
    expect(phaseRow('Activation').getByText('Truck within precinct tolerance')).toBeInTheDocument()
  })

  it('shows no location chip on a completed loading row with no fix and no stored verdict (LoadingDetail gates its own section on the exact same hasLocationEvidence check, so the chip must never advertise a section the opened card does not have)', () => {
    const trip = tripFor(TRIP_0035_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const verdictLabels = ['Truck within precinct tolerance', 'Truck outside precinct tolerance', 'Truck precinct check unavailable', 'Truck precinct check unavailable for transit legs']
    for (const label of verdictLabels) {
      expect(phaseRow('Loading').queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('shows the stored outside-tolerance chip on a loading row once a verdict is actually recorded', () => {
    const base = tripFor(TRIP_0035_ID)
    const trip: Trip = {
      ...base,
      phases: base.phases.map(p => p.phase_type === 'loading' ? { ...p, pulsit_geofence_confirmed: false } : p),
    }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    expect(phaseRow('Loading').getByText('Truck outside precinct tolerance')).toBeInTheDocument()
  })

  it('shows no location chip on trip_creation or in_transit rows, even when they are done', () => {
    const trip = tripFor(TRIP_0035_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    // Every verdict label this summary could ever render: none may appear in either row.
    const verdictLabels = ['Truck within precinct tolerance', 'Truck outside precinct tolerance', 'Truck precinct check unavailable', 'Truck precinct check unavailable for transit legs']
    for (const label of verdictLabels) {
      expect(phaseRow('Trip Created').queryByText(label)).not.toBeInTheDocument()
      expect(phaseRow('In Transit').queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('shows no location chip on a pending phase', () => {
    const trip = tripFor(TRIP_0043_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const verdictLabels = ['Truck within precinct tolerance', 'Truck outside precinct tolerance', 'Truck precinct check unavailable', 'Truck precinct check unavailable for transit legs']
    for (const label of verdictLabels) {
      expect(phaseRow('Activation').queryByText(label)).not.toBeInTheDocument()
    }
  })
})

describe('TripTimeline: gps_mismatch exception evidence', () => {
  it('renders the honest trigger text inside a linked activation exception\'s supporting evidence', () => {
    const base = tripFor(TRIP_0035_ID)
    const activation = base.phases.find(p => p.phase_type === 'activation')
    if (!activation) throw new Error('TRIP_0035 activation phase is missing')

    const gpsMismatch: TripException = {
      id: 'gps-mismatch-activation' as TripException['id'],
      trip_id: base.id,
      exception_type: 'gps_mismatch',
      source: 'system',
      severity: 'warning',
      description: 'Vehicle tracker placed the vehicle outside the activation geofence.',
      phase_event_id: activation.phase_event_id,
      checkpoint_id: null,
      supporting_artifact_id: null,
      review_status: 'recorded',
      review_outcome: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      review_note: null,
      contact_method: null,
      // A gps_mismatch is not a breakdown, so it names no vehicle (trailer analytics, dev).
      vehicle_id: null,
      merkle_batch_id: null,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    }
    const trip: Trip = { ...base, exceptions: [...base.exceptions, gpsMismatch] }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    // The row's own aria-label gains " and exceptions" once it carries one (see
    // TripTimeline's own group label logic), so it is looked up by that full name here,
    // unlike the plain "Activation phase" rows in the describe block above.
    const activationRow = within(screen.getByRole('group', { name: 'Activation phase and exceptions' }))
    fireEvent.click(activationRow.getByRole('button', { name: /1 exception · 0 need review/ }))
    expect(activationRow.getByTestId('gps-mismatch-trigger')).toHaveTextContent('Vehicle tracker outside the facility boundary')
  })

  it('shows exactly one "View on map" button, nested inside the exception card, for a system-raised gps_mismatch with recorded fixes', () => {
    const base = tripFor(TRIP_0035_ID)
    const activation = base.phases.find(p => p.phase_type === 'activation')
    if (!activation) throw new Error('TRIP_0035 activation phase is missing')

    // Gives ExceptionMapButton (assessment-less path) and the "Supporting evidence"
    // panel's own PositionDisagreement the same phase-based fixes to compare, matching
    // the browser-observed regression: both used to render their own "View on map".
    const activationWithFixes: PhaseDescriptor = {
      ...activation,
      driver_phone_lat: -33.9249,
      driver_phone_lng: 18.4241,
      horse_gps_lat: -33.9351,
      horse_gps_lng: 18.4241,
    }
    const gpsMismatch: TripException = {
      id: 'gps-mismatch-activation-2' as TripException['id'],
      trip_id: base.id,
      exception_type: 'gps_mismatch',
      source: 'system',
      severity: 'warning',
      description: 'Vehicle tracker placed the vehicle outside the activation geofence.',
      phase_event_id: activation.phase_event_id,
      checkpoint_id: null,
      supporting_artifact_id: null,
      review_status: 'recorded',
      review_outcome: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      review_note: null,
      contact_method: null,
      vehicle_id: null,
      merkle_batch_id: null,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
    }
    const trip: Trip = {
      ...base,
      phases: base.phases.map(p => p.phase_event_id === activation.phase_event_id ? activationWithFixes : p),
      exceptions: [...base.exceptions, gpsMismatch],
    }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const activationRow = within(screen.getByRole('group', { name: 'Activation phase and exceptions' }))
    fireEvent.click(activationRow.getByRole('button', { name: /1 exception · 0 need review/ }))
    // Opens the "Supporting evidence" disclosure too, so a still-hidden duplicate inside
    // it cannot pass this assertion by staying collapsed.
    fireEvent.click(activationRow.getByText('Supporting evidence'))

    const mapButtons = activationRow.getAllByRole('button', { name: VIEW_ON_MAP_LABEL })
    expect(mapButtons).toHaveLength(1)
    // Proves the button now lives inside the exception's own card, not as a sibling
    // element floating below it.
    expect(mapButtons[0]!.closest('article')).not.toBeNull()
  })
})

describe('TripTimeline: transit journey summary stays outside disclosure', () => {
  it('shows the compact journey summary for a completed leg while its card is still collapsed', () => {
    const trip = tripFor(TRIP_0035_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const row = phaseGroupElement('In Transit')
    // Closed trip, no active phase: this row is an ordinary collapsible card, not the
    // always-open "driving" state — proving the summary needs no expansion to show.
    expect(within(row).getByRole('button', { expanded: false })).toBeInTheDocument()
    expect(within(row).getByText(/FedEx DBN/)).toBeInTheDocument()
    const time = row.querySelector('time')
    expect(time).toBeInTheDocument()
  })

  it('shows "En route to <destination>" for the currently driving leg', () => {
    const trip = tripFor(TRIP_0041_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const row = phaseGroupElement('In Transit')
    // Exactly once: InTransitTimeline (the always-open full detail while driving) no
    // longer renders its own departure/arrival wording at all — that fact lives
    // entirely in the persistent summary now (review round 1 caught this rendering
    // twice, once here and once in InTransitTimeline's own node).
    expect(within(row).getAllByText(/En route to FedEx DBN/)).toHaveLength(1)
  })

  it('offers a current-leg strip only after its active row leaves the timeline scroller', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    let notify: ((entries: IntersectionObserverEntry[]) => void) | undefined
    let observerRoot: Element | Document | null | undefined
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void, options?: IntersectionObserverInit) {
        notify = callback
        observerRoot = options?.root ?? null
      }
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
      takeRecords = () => []
      root = null
      rootMargin = ''
      thresholds = []
    })
    const onJump = vi.fn()
    const rendered = render(<div data-timeline-scroller><TripTimeline trip={tripFor(TRIP_0041_ID)} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={onJump} {...evidence} /></div>)

    expect(screen.queryByRole('button', { name: 'Show current leg' })).not.toBeInTheDocument()
    act(() => notify?.([{ isIntersecting: false } as IntersectionObserverEntry]))
    expect(screen.getByRole('button', { name: 'Show current leg' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show current leg' }))
    expect(onJump).toHaveBeenCalledOnce()
    expect(observe).toHaveBeenCalledOnce()
    expect(observerRoot).toBe(rendered.container.querySelector('[data-timeline-scroller]'))
    rendered.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('shows no journey summary or invented status on a cancelled trip\'s in-transit leg', () => {
    const base = tripFor(TRIP_0041_ID)
    const trip: Trip = {
      ...base,
      status: 'cancelled',
      // cancel_trip leaves every phase row PENDING — the honest record of an
      // abandoned plan (see lib/phase/derive.ts and PhaseOverrideAction's own note).
      phases: base.phases.map(p => ({ ...p, status: 'pending' as const, completed_at: null })),
    }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const row = phaseGroupElement('In Transit')
    expect(within(row).queryByText(/Awaiting departure/)).not.toBeInTheDocument()
    expect(within(row).queryByText(/En route/)).not.toBeInTheDocument()
    expect(within(row).queryByText(/Arrived/)).not.toBeInTheDocument()
  })

  it('does not fabricate an arrival time for an overridden transit leg', () => {
    const base = tripFor(TRIP_0035_ID)
    const trip: Trip = {
      ...base,
      phases: base.phases.map(p => p.phase_type === 'in_transit'
        ? { ...p, status: 'overridden' as const, completed_at: '2099-01-01T00:00:00Z', dispatcher_override_note: 'Driver phone lost' }
        : p),
    }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const row = phaseGroupElement('In Transit')
    // "Arrived" only ever appears as the journey mini-timeline's own completed-leg
    // node (see InTransitTimeline) — its absence here, alongside the "En route"
    // wording below, proves the summary read this as a leg that departed but never
    // arrived, not as a completed leg dated by the override timestamp. (The row's own
    // unrelated header still prints phase.completed_at for every phase type — that is
    // pre-existing PhaseTimelineItem behaviour, out of this task's scope.)
    expect(within(row).queryByText(/Arrived/)).not.toBeInTheDocument()
    expect(within(row).getByText(/En route to FedEx DBN/)).toBeInTheDocument()
  })

  it('shows severity counts scoped to this leg\'s own exceptions, not the trip\'s other exceptions, without a duplicate full card', () => {
    const base = tripFor(TRIP_0035_ID)
    const transitPhase = base.phases.find(p => p.phase_type === 'in_transit')
    if (!transitPhase) throw new Error('TRIP_0035 in_transit phase is missing')

    const scoped = makeTransitException({ id: 'exc-scoped' as ExceptionId, phase_event_id: transitPhase.phase_event_id, severity: 'critical' })
    const unrelated = makeTransitException({ id: 'exc-other' as ExceptionId, phase_event_id: null, severity: 'critical', exception_type: 'dispatcher_note' })
    const trip: Trip = { ...base, exceptions: [...base.exceptions, scoped, unrelated] }

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const row = phaseGroupElement('In Transit')
    // One journey marker for the leg's own exception; the trip-level record is not
    // this leg's and must not appear on it.
    expect(within(row).getAllByTestId('transit-exception-marker')).toHaveLength(1)
    expect(within(row).getByRole('button', { name: /1 exception · 0 need review/ })).toHaveTextContent('Critical')
    // The full card is behind the branch toggle, never an unconditional stack below.
    expect(screen.queryAllByRole('group', { name: 'Exception linked to In Transit phase' })).toHaveLength(0)
  })

  it('scopes each of two transit legs to its own exceptions by phase id, even when a later leg returns to the same precinct', () => {
    const trip = crossDockTrip()

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const rows = screen.getAllByRole('group', { name: /^In Transit phase/ })
    expect(rows).toHaveLength(2)
    const [leg1Row, leg2Row] = rows.map(row => within(row))

    // Leg 1 departs FedEx JHB and arrives FedEx DBN.
    expect(leg1Row.getByText(/FedEx DBN/)).toBeInTheDocument()
    expect(leg1Row.getByRole('button', { name: /1 exception/ })).toHaveTextContent('Critical')
    expect(leg1Row.getByRole('button', { name: /1 exception/ })).not.toHaveTextContent('Warning')

    // Leg 2 departs FedEx DBN and arrives back at FedEx JHB — the repeated stop.
    // Its exception must not leak from, or into, leg 1's row.
    expect(leg2Row.getByText(/FedEx JHB/)).toBeInTheDocument()
    expect(leg2Row.getByRole('button', { name: /1 exception/ })).toHaveTextContent('Warning')
    expect(leg2Row.getByRole('button', { name: /1 exception/ })).not.toHaveTextContent('Critical')

    expect(screen.queryAllByRole('group', { name: /^Exception linked to In Transit phase/ })).toHaveLength(0)
  })

  it('keeps a phase card\'s open/closed state across a background rerender with fresh trip data', () => {
    const trip = tripFor(TRIP_0035_ID)

    const { rerender } = render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={1} onJump={vi.fn()} {...evidence} />,
    )

    const row = phaseGroupElement('In Transit')
    fireEvent.click(within(row).getByRole('button', { expanded: false }))
    expect(within(row).getByRole('button', { expanded: true })).toBeInTheDocument()

    // A silent background refetch hands TripTimeline a new trip object (same data,
    // different reference) — the row must not silently re-collapse underneath the
    // dispatcher because of it.
    rerender(
      <TripTimeline trip={{ ...trip }} precincts={mockPrecincts} returnTo="/trips" lastUpdated={2} onJump={vi.fn()} {...evidence} />,
    )

    expect(within(phaseGroupElement('In Transit')).getByRole('button', { expanded: true })).toBeInTheDocument()
  })

  it('still shows the full journey detail, including the honest-absence line, once a collapsed card is expanded', () => {
    const trip = tripFor(TRIP_0035_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const row = phaseGroupElement('In Transit')
    fireEvent.click(within(row).getByRole('button', { expanded: false }))

    expect(within(row).getByText('Only recorded journey events are shown.')).toBeInTheDocument()
  })

  it('shows a completed leg\'s departure/arrival fact exactly once, even once its card is expanded', () => {
    // Review round 1: expanding a completed leg used to show "Arrived FedEx DBN"
    // twice — once from the persistent summary (always visible) and once from
    // InTransitTimeline's own now-removed arrival node. Guards against that
    // regression at the composed-row level, not just inside InTransitTimeline itself.
    const trip = tripFor(TRIP_0035_ID)

    render(
      <TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />,
    )

    const row = phaseGroupElement('In Transit')
    fireEvent.click(within(row).getByRole('button', { expanded: false }))

    expect(within(row).getAllByText(/Arrived FedEx DBN/)).toHaveLength(1)
  })

  it('keeps compact transit markers visible while its full exception cards disclose independently', () => {
    const base = tripFor(TRIP_0035_ID)
    const transit = base.phases.find(phase => phase.phase_type === 'in_transit')
    if (!transit) throw new Error('TRIP_0035 in_transit phase is missing')
    const finding = makeTransitException({ id: 'transit-detail' as ExceptionId, phase_event_id: transit.phase_event_id, severity: 'warning' })

    render(<TripTimeline trip={{ ...base, exceptions: [...base.exceptions, finding] }} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />)

    const row = phaseGroupElement('In Transit')
    expect(within(row).getAllByTestId('transit-exception-marker')).toHaveLength(1)
    fireEvent.click(within(row).getByRole('button', { name: /1 exception · 0 need review/ }))
    expect(within(row).getByText('Vehicle deviated from the planned route.')).toBeInTheDocument()
    expect(within(row).getAllByTestId('transit-exception-marker')).toHaveLength(1)
  })
})

describe('TripTimeline: phase exception disclosure', () => {
  it('deduplicates the full collection before phase and trip-level records are derived', () => {
    const base = tripFor(TRIP_0035_ID)
    const loading = base.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0035 loading phase is missing')
    const tripRecord = makeTransitException({ id: 'conflicting-poll-record' as ExceptionId, phase_event_id: null, severity: 'warning' })
    const conflictingPhaseCopy = { ...tripRecord, phase_event_id: loading.phase_event_id, description: 'Conflicting phase payload' }

    render(<TripTimeline trip={{ ...base, exceptions: [...base.exceptions, tripRecord, conflictingPhaseCopy] }} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} {...evidence} />)

    expect(phaseGroupElement('Loading')).toHaveAccessibleName('Loading phase')
    const tripEvents = screen.getByRole('region', { name: 'Trip-level events' })
    expect(within(tripEvents).getAllByRole('heading', { name: 'Route Deviation' })).toHaveLength(1)
  })

  it('keeps phase and exception disclosure independent, deduplicates cards, and opens the matching panel filter', () => {
    const base = tripFor(TRIP_0035_ID)
    const loading = base.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0035 loading phase is missing')
    const first = makeTransitException({ id: 'loading-exception-1' as ExceptionId, phase_event_id: loading.phase_event_id, severity: 'critical', review_status: 'needs_review' })
    const duplicate = { ...first, description: 'Duplicate payload' }
    const second = makeTransitException({ id: 'loading-exception-2' as ExceptionId, phase_event_id: loading.phase_event_id, severity: 'warning' })
    const onOpenExceptions = vi.fn()
    const trip: Trip = { ...base, exceptions: [...base.exceptions, first, duplicate, second] }

    render(<TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={null} onJump={vi.fn()} onOpenExceptions={onOpenExceptions} {...evidence} />)

    const row = phaseGroupElement('Loading')
    const phaseToggle = within(row).getAllByRole('button', { expanded: false })[0]!
    const exceptionToggle = within(row).getByRole('button', { name: /2 exceptions · 1 needs review/ })
    expect(exceptionToggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(exceptionToggle)
    expect(exceptionToggle).toHaveAttribute('aria-expanded', 'true')
    expect(phaseToggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(row).getAllByText('Route Deviation')).toHaveLength(2)

    // One trigger per card now, not one shared link below the group — both exceptions
    // in this phase carry it, and either opens the same phase-scoped panel.
    const panelButtons = within(row).getAllByRole('button', { name: 'Open in exceptions panel' })
    expect(panelButtons).toHaveLength(2)
    fireEvent.click(panelButtons[0]!)
    expect(onOpenExceptions).toHaveBeenCalledWith(loading.phase_event_id)
  })

  it('keeps an opened exception disclosure across a refetch with a new trip object', () => {
    const base = tripFor(TRIP_0035_ID)
    const loading = base.phases.find(phase => phase.phase_type === 'loading')
    if (!loading) throw new Error('TRIP_0035 loading phase is missing')
    const finding = makeTransitException({ id: 'loading-persisted' as ExceptionId, phase_event_id: loading.phase_event_id, severity: 'warning' })
    const trip: Trip = { ...base, exceptions: [...base.exceptions, finding] }

    const { rerender } = render(<TripTimeline trip={trip} precincts={mockPrecincts} returnTo="/trips" lastUpdated={1} onJump={vi.fn()} onOpenExceptions={vi.fn()} {...evidence} />)
    const toggle = within(phaseGroupElement('Loading')).getByRole('button', { name: /1 exception · 0 need review/ })
    fireEvent.click(toggle)

    rerender(<TripTimeline trip={{ ...trip }} precincts={mockPrecincts} returnTo="/trips" lastUpdated={2} onJump={vi.fn()} onOpenExceptions={vi.fn()} {...evidence} />)
    expect(within(phaseGroupElement('Loading')).getByRole('button', { name: /1 exception · 0 need review/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
