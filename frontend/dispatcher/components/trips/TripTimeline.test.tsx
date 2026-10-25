import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { TripTimeline, type TimelineView } from './TripTimeline'
import { exceptionRowId } from '@/components/domain/ExceptionRow'
import { VIEW_ON_MAP_LABEL } from '@/components/domain/LocationEvidencePanel'
import { CHECK_WORDING } from '@/lib/phase/checks'
import { mockPrecincts, mockTrips, TRIP_0035_ID, TRIP_0040_ID, TRIP_0041_ID } from '@shared/lib/mocks'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { ExceptionId, TripException } from '@shared/lib/types/exception'
import type { PhaseDescriptor, PhaseEventId, PhaseType } from '@shared/lib/types/phase'
import type { ConsignmentRead, Trip } from '@shared/lib/types/trip'
import type { IncidentSummary } from '@/lib/types/incident'
import { line } from '@/components/domain/__tests__/textLine'

// PhaseOverrideAction imports lib/api/client -> lib/supabase/client, which calls createClient()
// at import time and throws without a real Supabase URL.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// ForensicOnly is gated on a real provider (itself gated on useAuth); the gate is what is
// under test, so its two inputs are set directly.
const forensic = vi.hoisted(() => ({ canViewForensics: true, forensicOn: false, toggle: vi.fn() }))
vi.mock('@/lib/context/ForensicModeContext', () => ({ useForensicMode: () => forensic }))

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-me' } }) }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('@/components/map/LocationComparisonMap', () => ({ LocationComparisonMap: () => null }))
vi.mock('@/components/blockchain/VerifyButton', () => ({
  VerifyButton: ({ subjectId, ariaLabel }: { subjectId: string; ariaLabel?: string }) => (
    <button type="button" aria-label={ariaLabel} data-testid="verify-subject">{subjectId}</button>
  ),
}))

const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()
const SERVER_TIME = '2026-05-03T19:45:00Z'
const ADDRESS_LINE = '1 Test Road'

const evidence = {
  artifactsById: NO_ARTIFACTS,
  artifactLoading: false,
  artifactError: null as string | null,
  onRetryArtifacts: vi.fn(),
  onChanged: vi.fn(),
}

type Overrides = Partial<React.ComponentProps<typeof TripTimeline>>

function ViewTimeline({ trip, ...overrides }: { trip: Trip } & Overrides): React.JSX.Element {
  const [view, setView] = useState<TimelineView>('evidence')
  return <TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} {...overrides}
    view={view} onViewChange={setView} />
}

describe('TripTimeline Evidence and Minimised views', () => {
  it('uses the small segmented tabs and keeps keyboard switching local to each timeline', async () => {
    render(<><ViewTimeline trip={closedTrip()} /><ViewTimeline trip={closedTrip()} /></>)
    const selectors = screen.getAllByRole('tablist', { name: 'Timeline view' })
    const secondEvidence = within(selectors[1]).getByRole('tab', { name: 'Evidence' })
    const secondMinimised = within(selectors[1]).getByRole('tab', { name: 'Minimised' })
    expect(secondEvidence).toHaveClass('text-[10px]')
    secondEvidence.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(secondMinimised).toHaveFocus()
    expect(secondMinimised).toHaveAttribute('aria-selected', 'true')
    expect(within(selectors[0]).getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true')
    expect(secondMinimised.id).not.toBe(within(selectors[0]).getByRole('tab', { name: 'Minimised' }).id)
  })

  it('defaults to Evidence and exposes a view selector', () => {
    renderTimeline(closedTrip())
    expect(screen.getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Minimised' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByRole('table', { name: 'Minimised phase outcomes' })).not.toBeInTheDocument()
  })

  it('keeps the same ordered cards in Minimised, each collapsed to its headline and exception count', async () => {
    const trip = closedTrip()
    const loading = phaseOf(trip, 'loading')
    const item = exception('selected', { phase_event_id: loading.phase_event_id })
    render(<ViewTimeline trip={{ ...trip, phases: [...trip.phases].reverse(), exceptions: [item, { ...item }] }} selectedExceptionId={item.id} />)
    const evidenceOrder = trip.phases.map(phase => document.getElementById(`phase-${phase.phase_event_id}`))
    expect(within(phaseGroup('Loading')).getAllByRole('listitem').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('tab', { name: 'Minimised' }))

    // Same cards, same anchors: Minimised only changes what a collapsed card shows.
    expect(trip.phases.map(phase => document.getElementById(`phase-${phase.phase_event_id}`))).toEqual(evidenceOrder)
    const card = phaseGroup('Loading')
    expect(card).toHaveTextContent('Needs attention')
    expect(card).toHaveTextContent('1 exception · 1 needs review')
    expect(within(card).queryByRole('listitem')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Route Deviation/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('opens a minimised card to the same full detail as in Evidence', async () => {
    const trip = closedTrip({ loading: { linehaul_photo_artifact_id: 'sheet', parcel_count_origin: 16 } })
    const phase = phaseOf(trip, 'loading')
    trip.exceptions = [exception('loading-event', { phase_event_id: phase.phase_event_id })]
    const artifacts = artifactMap(artifact('sheet', phase.phase_event_id, 'linehaul_photo', { captured_at: '2026-05-03T19:46:00Z' }))
    render(<ViewTimeline trip={trip} artifactsById={artifacts} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
    expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'false')

    openCard('Loading')

    const card = phaseGroup('Loading')
    expect(within(card).getByRole('img')).toBeInTheDocument()
    expect(within(card).getByText('Description of loading-event')).toBeInTheDocument()
    expect(card).toHaveTextContent('Needs attention')
  })

  it('keeps open cards and nested photo groups open across a view round trip, and closed cards closed', async () => {
    const base = tripFor(TRIP_0040_ID)
    const departure = phaseOf(base, 'departure')
    const trip = { ...base, phases: base.phases.map(phase => phase.sequence_number >= departure.sequence_number
      ? { ...phase, status: 'pending' as const, completed_at: null } : phase) }
    const uploads = ['u1', 'u2', 'u3'].map(id => artifact(id, departure.phase_event_id, 'seal_photo'))
    render(<ViewTimeline trip={trip} artifactsById={artifactMap(...uploads)} />)
    const recorded = zone('Departure', 'Recorded')
    await userEvent.click(within(recorded).getByRole('button', { name: '+2 more' }))
    const photoGroup = within(recorded).getByRole('button', { name: 'Show fewer' })
    const activationToggle = toggleOf('Activation')
    expect(activationToggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Evidence' }))

    expect(zone('Departure', 'Recorded')).toBe(recorded)
    expect(within(recorded).getByRole('button', { name: 'Show fewer' })).toBe(photoGroup)
    expect(within(recorded).getAllByRole('img')).toHaveLength(3)
    expect(activationToggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps In Transit open with no toggle in Evidence, and collapses it like any other card in Minimised', async () => {
    const trip = closedTrip()
    trip.exceptions = [exception('transit-event', { phase_event_id: phaseOf(trip, 'in_transit').phase_event_id })]
    render(<ViewTimeline trip={trip} />)
    expect(toggleOf('In Transit')).toBeNull()
    expect(within(phaseGroup('In Transit')).getByText('Reached FedEx DBN')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Minimised' }))

    const card = phaseGroup('In Transit')
    expect(toggleOf('In Transit')).toHaveAttribute('aria-expanded', 'false')
    expect(within(card).queryByText('Reached FedEx DBN')).not.toBeInTheDocument()
    // Collapsing must not hide the signal: the headline and the count stay on the card.
    expect(card.querySelector('[data-outcome]')).toHaveTextContent('1 exception')
    openCard('In Transit')
    expect(within(card).getByText('Reached FedEx DBN')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Evidence' }))
    expect(toggleOf('In Transit')).toBeNull()
    expect(within(card).getByText('Reached FedEx DBN')).toBeInTheDocument()
  })

  it('swaps the minimised count for the full verdict line once the card is opened', async () => {
    const trip = closedTrip()
    trip.exceptions = [exception('loading-event', { phase_event_id: phaseOf(trip, 'loading').phase_event_id })]
    render(<ViewTimeline trip={trip} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
    const card = phaseGroup('Loading')
    expect(card.querySelector('[data-outcome]')).toHaveTextContent('1 exception · 1 needs review')

    openCard('Loading')

    expect(card.querySelector('[data-outcome]')).not.toHaveTextContent('1 exception · 1 needs review')
    expect(card.querySelector('[data-outcome]')).toHaveTextContent('Needs attention')
  })

  it('keeps trip-level records visible in Minimised, with the same cap and panel link', async () => {
    const item = exception('trip-note')
    render(<ViewTimeline trip={closedTrip({}, { exceptions: [item, { ...item }] })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Minimised' }))
    expect(within(screen.getByRole('region', { name: 'Trip-level events' })).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(1)
  })

  it('does not reopen a previously revealed card that the reader closed before a view round trip', async () => {
    const trip = closedTrip()
    const loading = phaseOf(trip, 'loading')
    const record = exception('once-revealed', { phase_event_id: loading.phase_event_id })
    trip.exceptions = [record]
    const request = { exceptionId: record.id, phaseId: loading.phase_event_id, requestId: 1 }
    const onRevealHandled = vi.fn()
    const { rerender } = renderTimeline(trip, { revealRequest: request, onRevealHandled })
    await waitFor(() => expect(onRevealHandled).toHaveBeenCalledOnce())
    fireEvent.click(toggleOf('Loading')!)
    expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'false')
    rerender(<TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} view="minimised" revealRequest={request} onRevealHandled={onRevealHandled} />)
    rerender(<TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} view="evidence" revealRequest={request} onRevealHandled={onRevealHandled} />)
    expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'false')
    expect(onRevealHandled).toHaveBeenCalledOnce()
  })
})

describe('Task 10b timeline regressions', () => {
  it('collapses loading to ordered compact acts, expanding to full rows once', () => {
    const trip = closedTrip({ loading: { linehaul_photo_artifact_id: 'sheet', parcel_count_origin: 16 } })
    const phase = phaseOf(trip, 'loading')
    trip.exceptions = [exception('loading-event', { phase_event_id: phase.phase_event_id, created_at: '2026-05-03T20:00:00Z' })]
    renderTimeline(trip, { artifactsById: artifactMap(artifact('sheet', phase.phase_event_id, 'linehaul_photo', { captured_at: '2026-05-03T19:46:00Z' })) })

    const card = phaseGroup('Loading')
    const rows = within(card).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Driver confirmed loading')
    expect(rows[0]).toHaveTextContent('16 parcels')
    expect(rows[1]).toHaveTextContent('Linehaul sheet photographed')
    expect(rows[2]).toHaveTextContent('Route Deviation')
    expect(within(card).queryByText('Description of loading-event')).not.toBeInTheDocument()
    expect(within(card).queryByRole('img')).not.toBeInTheDocument()
    openCard('Loading')
    expect(within(card).getByText('Description of loading-event')).toBeInTheDocument()
    expect(within(card).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(1)
    expect(within(card).getByRole('img')).toBeInTheDocument()
  })

  it('keeps trip_creation exceptions on the Trip Created card collapsed and open', () => {
    const trip = closedTrip()
    trip.exceptions = [exception('creation-event', { phase_event_id: phaseOf(trip, 'trip_creation').phase_event_id })]
    renderTimeline(trip)

    const card = phaseGroup('Trip Created')
    expect(within(card).getByRole('button', { name: /Route Deviation/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(1)
    openCard('Trip Created')
    expect(within(card).getByText('Description of creation-event')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(1)
  })

  it('keeps warning nodes and verdicts amber on a neutral card', () => {
    const trip = closedTrip()
    trip.exceptions = [exception('e', { phase_event_id: phaseOf(trip, 'loading').phase_event_id })]
    renderTimeline(trip)

    const card = phaseGroup('Loading')
    expect(card.querySelector('[data-node-type="warn"]')).toHaveClass('bg-warn-c')
    expect(card.querySelector('[data-outcome="attention"] .text-warn')).not.toBeNull()
    expect(card.querySelector('.bg-warn-c\\/40')).toBeNull()
  })

  it('names the transit leg with an arrow and records Reached and Departed', () => {
    renderTimeline(closedTrip())
    const card = phaseGroup('In Transit')

    expect(card.textContent).toContain('FedEx JHB → FedEx DBN')
    expect(card.textContent).toContain('Reached FedEx DBN')
    expect(card.querySelector('[data-outcome]')?.textContent).toContain('Departed')
  })

  it('caps trip-level records and opens all trip-level records from more', async () => {
    const trip = closedTrip({}, { exceptions: Array.from({ length: 5 }, (_, i) => exception(`trip-${i}`)) })
    const onOpenException = vi.fn()
    const { rerender } = renderTimeline(trip, { onOpenException })
    const list = screen.getByRole('region', { name: 'Trip-level events' })

    expect(within(list).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(3)
    await userEvent.click(within(list).getByRole('button', { name: /\+2 more/ }))
    expect(onOpenException).toHaveBeenCalledWith(null, null)
    rerender(<TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} revealRequest={{ exceptionId: 'trip-4', phaseId: null, requestId: 1 }} />)
    await waitFor(() => expect(document.getElementById(exceptionRowId('trip-4'))).toHaveAttribute('data-highlighted', 'true'))
  })
})

function renderTimeline(trip: Trip, overrides: Overrides = {}) {
  return render(
    <TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} {...overrides} />,
  )
}

function tripFor(id: typeof TRIP_0035_ID | typeof TRIP_0040_ID | typeof TRIP_0041_ID): Trip {
  const trip = mockTrips.find(candidate => candidate.id === id)
  if (!trip) throw new Error(`fixture ${id} is missing`)
  return trip
}

function phaseGroup(phaseName: string): HTMLElement {
  return screen.getByRole('group', { name: new RegExp(`^${phaseName} phase`) })
}

/** The card's own toggle, found by its name (it opens with the phase title) so the "+n more"
 *  disclosures inside an opened card are never mistaken for it. */
function toggleOf(phaseName: string): HTMLElement | null {
  return within(phaseGroup(phaseName)).queryByRole('button', { name: new RegExp(`^${phaseName}`) })
}

/** Opens a collapsed card; a card that is already open (no toggle) is returned as is. */
function openCard(phaseName: string): HTMLElement {
  const toggle = toggleOf(phaseName)
  if (toggle?.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle)
  return phaseGroup(phaseName)
}

function zone(phaseName: string, name: 'Recorded' | 'Checked' | 'Audit trail'): HTMLElement {
  return within(openCard(phaseName)).getByRole('region', { name })
}

/** The titles of the check lines in a Checked zone: the verdict a dispatcher reads, not the raw
 *  location fields behind "Location details", which repeat the same words. */
function checkLines(checked: HTMLElement): string[] {
  return [...checked.querySelectorAll('[data-check-result] p:first-child')].map(line => line.textContent ?? '')
}

function phaseOf(trip: Trip, type: PhaseType, nth = 0): PhaseDescriptor {
  const phase = trip.phases.filter(candidate => candidate.phase_type === type)[nth]
  if (!phase) throw new Error(`${type} phase is missing`)
  return phase
}

/** TRIP_0035 (closed, every phase completed) with its fixture exceptions cleared, so each test
 *  states exactly the evidence it needs. */
function closedTrip(patches: Partial<Record<PhaseType, Partial<PhaseDescriptor>>> = {}, extra: Partial<Trip> = {}): Trip {
  const base = tripFor(TRIP_0035_ID)
  return {
    ...base,
    exceptions: [],
    ...extra,
    phases: base.phases.map(phase => ({
      ...phase,
      completed_at: SERVER_TIME,
      seal_number: null, parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
      ...patches[phase.phase_type],
    })),
  }
}

function consignment(overrides: Partial<ConsignmentRead>): ConsignmentRead {
  return {
    id: 'c1', trip_id: 'trip-1', parcel_perfect_reference: 'PP-1', client_organization_id: null, origin_precinct_id: null,
    destination_precinct_id: null, declared_value: null, parcel_count_expected: 7, slot_time_origin: null,
    slot_time_destination: null, pp_raw_json: null, pickup_stop_id: null, delivery_stop_id: null, load_priority: null,
    unit_count_expected: null, pp_manifest_number: null, scanned_out_count: 0, scanned_in_count: 0,
    created_at: SERVER_TIME, updated_at: SERVER_TIME, ...overrides,
  }
}

function exception(id: string, overrides: Partial<TripException> = {}): TripException {
  return {
    id: id as ExceptionId, trip_id: 'trip-1', exception_type: 'route_deviation', source: 'system', severity: 'warning',
    description: `Description of ${id}`, phase_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
    review_status: 'needs_review', review_outcome: null, reviewed_by_user_id: null, reviewed_at: null, review_note: null,
    contact_method: null, vehicle_id: null, merkle_batch_id: null, claimed_by_user_id: null, claimed_at: null,
    claimed_by_name: null, reviewed_by_name: null, created_at: '2026-05-03T10:00:00Z', updated_at: '2026-05-03T10:00:00Z',
    ...overrides,
  }
}

function artifact(id: string, phaseId: string | null, role: EvidenceArtifactWithUrl['evidence_role'], overrides: Partial<EvidenceArtifactWithUrl> = {}): EvidenceArtifactWithUrl {
  return {
    id: id as EvidenceArtifactWithUrl['id'], trip_id: 'trip-1', artifact_type: 'photo', s3_key: 'k', s3_bucket: 'b',
    file_hash: 'f'.repeat(64), mime_type: 'image/jpeg', captured_at: '2026-05-03T10:00:00Z', captured_by_driver_id: 'driver-1',
    captured_by_user_id: null, captured_lat: null, captured_lng: null, created_at: '2026-05-03T10:00:30Z',
    phase_event_id: phaseId, evidence_role: role, signed_url: `https://example.test/${id}.jpg`, ...overrides,
  }
}

function artifactMap(...artifacts: EvidenceArtifactWithUrl[]): Map<string, EvidenceArtifactWithUrl> {
  return new Map(artifacts.map(a => [a.id, a]))
}

function receiptFor(phase: PhaseDescriptor): BlockchainReceipt {
  return {
    id: `receipt-${phase.phase_event_id}`, subject_type: 'phase_event', subject_id: phase.phase_event_id, receipt_type: 'pickup',
    data_hash: 'a'.repeat(64), hedera_topic_id: '0.0.12345', hedera_sequence_number: 7,
    hedera_consensus_timestamp: '2026-05-03T19:50:00Z', hedera_tx_id: null, created_at: SERVER_TIME,
  }
}

beforeEach(() => {
  forensic.canViewForensics = true
  forensic.forensicOn = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TripTimeline: the header verdict answers "did this phase go cleanly?" with the card collapsed', () => {
  it('says "Checks passed" on a phase whose checks all agree, and keeps the card collapsed', () => {
    renderTimeline(closedTrip({ departure: { seal_number: 'FP-1', pulsit_geofence_confirmed: true } }))

    const row = phaseGroup('Departure')
    expect(within(row).getByText('Checks passed')).toBeInTheDocument()
    // Clean is short (Batch 3): a count, with each passing check left to the Checked zone.
    expect(row.textContent).toMatch(/Checks passed · (\d+) of \1(?!\d)/)
    expect(within(row).queryByText(/No exceptions/)).toBeNull()
    expect(toggleOf('Departure')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/^Clean$/)).not.toBeInTheDocument()
  })

  it('keeps every passing check in the Checked zone once a clean card is opened', () => {
    renderTimeline(closedTrip({ departure: { seal_number: 'FP-1', pulsit_geofence_confirmed: true } }))

    fireEvent.click(toggleOf('Departure')!)

    const checked = within(phaseGroup('Departure')).getByRole('region', { name: 'Checked' })
    expect(within(checked).getAllByText('Truck within precinct tolerance').length).toBeGreaterThan(0)
    expect(phaseGroup('Departure').textContent).not.toMatch(/Checks passed · [^\d]/)
  })

  it('says "Not fully verified" when a check could not run, never "Checks passed"', () => {
    renderTimeline(closedTrip())

    const row = phaseGroup('Loading')
    expect(within(row).getByText('Not fully verified')).toBeInTheDocument()
    expect(within(row).queryByText('Checks passed')).not.toBeInTheDocument()
  })

  it('turns the node amber and says "Needs attention" for a failed parcel count that raised no exception', () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const trip = closedTrip(
      { loading: { parcel_count_origin: 7 }, confirmation: { parcel_count_destination: 6 } },
      { consignments: [consignment({ pickup_stop_id: loading.trip_stop_id })] },
    )

    renderTimeline(trip)

    const row = phaseGroup('Confirmation')
    expect(within(row).getByText('Needs attention')).toBeInTheDocument()
    expect(within(row).getByText(line(/1 parcel unaccounted for/))).toBeInTheDocument()
    expect(row.querySelector('[data-node-type]')).toHaveAttribute('data-node-type', 'warn')
  })

  it('keeps the node green for a phase that went cleanly', () => {
    renderTimeline(closedTrip({ departure: { seal_number: 'FP-1', pulsit_geofence_confirmed: true } }))

    expect(phaseGroup('Departure').querySelector('[data-node-type]')).toHaveAttribute('data-node-type', 'done')
  })

  it('says an exception was reviewed, and shows no reviewed tick for one that was only recorded', () => {
    const loading = phaseOf(closedTrip(), 'loading')
    const reviewed = exception('r1', { phase_event_id: loading.phase_event_id, review_status: 'reviewed', review_outcome: 'no_action_required' })
    const recorded = exception('r2', { phase_event_id: phaseOf(closedTrip(), 'departure').phase_event_id, review_status: 'recorded', severity: 'info' })

    renderTimeline(closedTrip({}, { exceptions: [reviewed, recorded] }))

    expect(within(phaseGroup('Loading')).getByText('Exception reviewed')).toBeInTheDocument()
    expect(within(phaseGroup('Departure')).getByText('Exception recorded')).toBeInTheDocument()
  })

  it('says a dispatcher override closed the phase, and that its checks did not run', () => {
    renderTimeline(closedTrip({ departure: { status: 'overridden', dispatcher_override_note: 'Phone lost', dispatcher_override_user_id: 'user-9' } }))

    const row = phaseGroup('Departure')
    expect(within(row).getAllByText('Closed by dispatcher override')[0]).toBeInTheDocument()
    expect(within(row).getByText(/Checks did not run/)).toBeInTheDocument()
  })

  it('says "Current phase" for the live phase of a running trip with nothing yet, and "Not started" for later ones', () => {
    renderTimeline(tripFor(TRIP_0040_ID))

    const verdict = phaseGroup('Arrival').querySelector('[data-outcome]')
    expect(verdict).toHaveTextContent('Current phase · Waiting for the driver')
    const confirmation = phaseGroup('Confirmation')
    expect(within(confirmation).getByText('Not started')).toBeInTheDocument()
    expect(toggleOf('Confirmation')).toBeNull()
  })

  it('shows trip_creation exactly as before: its own detail, and no verdict', () => {
    renderTimeline(closedTrip())

    const row = phaseGroup('Trip Created')
    expect(within(row).queryByText(/Needs attention|Checks passed|Not fully verified|In progress/)).not.toBeInTheDocument()
    fireEvent.click(toggleOf('Trip Created')!)
    expect(within(row).getByText('Full name')).toBeInTheDocument()
  })
})

describe('TripTimeline: card structure', () => {
  it('opens a resolved card to Recorded, then Checked, then (in forensic mode) Audit trail, in that order', () => {
    forensic.forensicOn = true
    const departure = phaseOf(closedTrip(), 'departure')
    const trip = closedTrip({ departure: { seal_number: 'FP-1', event_hash: 'b'.repeat(64), blockchain_receipt_id: `receipt-${departure.phase_event_id}` } },
      { blockchain_receipts: [receiptFor(departure)] })

    renderTimeline(trip)

    const row = openCard('Departure')
    const regions = within(row).getAllByRole('region').map(region => region.getAttribute('aria-label'))
    expect(regions).toEqual(['Recorded', 'Checked', 'Audit trail'])
  })

  it('collapses every resolved phase by default, and opens only the current one', () => {
    renderTimeline(tripFor(TRIP_0040_ID))

    expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'false')
    expect(toggleOf('Arrival')).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders one current card on a 13-phase cross-dock', () => {
    const base = tripFor(TRIP_0041_ID)
    const plan: PhaseType[] = [
      'trip_creation', 'activation', 'loading', 'departure', 'in_transit', 'arrival', 'unloading',
      'loading', 'departure', 'in_transit', 'arrival', 'unloading', 'confirmation',
    ]
    const firstOpen = plan.lastIndexOf('in_transit')
    const template = (type: PhaseType): PhaseDescriptor => base.phases.find(phase => phase.phase_type === type)!
    const phases: PhaseDescriptor[] = plan.map((type, index) => ({
      ...template(type),
      phase_event_id: `cd-${index}` as PhaseEventId,
      sequence_number: index,
      status: index < firstOpen ? 'completed' : 'pending',
      completed_at: index < firstOpen ? SERVER_TIME : null,
    }))

    const { container } = renderTimeline({ ...base, phases, exceptions: [] })

    expect(phases).toHaveLength(13)
    expect(container.querySelectorAll('[data-node-type="next"]')).toHaveLength(1)
    expect(screen.getAllByRole('group', { name: /^In Transit phase/ })).toHaveLength(2)
  })

  it('keeps a card\'s open or closed state across a background refresh with a new trip object', () => {
    const trip = closedTrip()
    const { rerender } = renderTimeline(trip)

    fireEvent.click(toggleOf('Loading')!)
    rerender(<TripTimeline trip={{ ...trip }} precincts={mockPrecincts} lastUpdated={2} onJump={vi.fn()} {...evidence} />)

    expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('TripTimeline: nothing lost when the detail panels are unmounted (design note §2)', () => {
  it('activation: precinct, address and slot time sit behind "Location details", and "Arrived" is gone', () => {
    const base = closedTrip()
    const activation = phaseOf(base, 'activation')
    const precinct = mockPrecincts.find(p => p.id === base.stops.find(s => s.id === activation.trip_stop_id)?.precinct_id)!
    const slot = '2026-05-03T07:00:00Z'
    const trip = { ...base, stops: base.stops.map(stop => stop.id === activation.trip_stop_id ? { ...stop, slot_time: slot } : stop) }
    const patchedPrecincts = mockPrecincts.map(p => p.id === precinct.id ? { ...p, address: ADDRESS_LINE } : p)

    render(<TripTimeline trip={trip} precincts={patchedPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} />)

    const checked = zone('Activation', 'Checked')
    fireEvent.click(within(checked).getByText('Location details'))
    expect(within(checked).getByText(precinct.name)).toBeInTheDocument()
    expect(within(checked).getByText(ADDRESS_LINE)).toBeInTheDocument()
    expect(within(checked).getByText(fmtDateTime(slot))).toBeInTheDocument()
    expect(within(phaseGroup('Activation')).queryByText('Arrived')).not.toBeInTheDocument()
  })

  it('loading: the expected and scanned figures, in Checked', () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const trip = closedTrip({ loading: { parcel_count_origin: 7 } }, { consignments: [consignment({ pickup_stop_id: loading.trip_stop_id, parcel_count_expected: 7 })] })

    renderTimeline(trip)

    const checked = zone('Loading', 'Checked')
    expect(within(checked).getByText('All parcels scanned')).toBeInTheDocument()
    expect(within(checked).getByText(line('7 scanned of 7 expected'))).toBeInTheDocument()
    expect(within(zone('Loading', 'Recorded')).getByText(line('7 parcels scanned onto truck'))).toBeInTheDocument()
  })

  it('departure: the seal number on the completion row', () => {
    renderTimeline(closedTrip({ departure: { seal_number: 'FP-7204' } }))

    expect(within(zone('Departure', 'Recorded')).getByText(line('Seal FP-7204'))).toBeInTheDocument()
  })

  it('arrival: the seal read, its condition, and this leg\'s departure seal', () => {
    const trip = closedTrip({ departure: { seal_number: 'FP-1234' }, arrival: { seal_number: 'FP-9999', seal_condition: 'damaged' } })

    renderTimeline(trip)

    const recorded = zone('Arrival', 'Recorded')
    expect(within(recorded).getByText(line('Seal read FP-9999'))).toBeInTheDocument()
    expect(within(recorded).getByText('Seal found damaged')).toBeInTheDocument()
    const checked = zone('Arrival', 'Checked')
    expect(within(checked).getByText('Seal number differs from departure')).toBeInTheDocument()
    expect(within(checked).getByText(line('Recorded FP-1234 at departure and FP-9999 at arrival.'))).toBeInTheDocument()
    expect(within(checked).getByText('Seal found damaged')).toBeInTheDocument()
  })

  it('unloading: scanned off the truck against expected at the stop', () => {
    const base = closedTrip()
    const unloading = phaseOf(base, 'unloading')
    const trip = closedTrip({}, { consignments: [consignment({ delivery_stop_id: unloading.trip_stop_id, parcel_count_expected: 7, scanned_in_count: 6 })] })

    renderTimeline(trip)

    const checked = zone('Unloading', 'Checked')
    expect(within(checked).getByText(line('1 parcel not scanned'))).toBeInTheDocument()
    expect(within(checked).getByText(line('6 scanned of 7 expected'))).toBeInTheDocument()
  })

  it('unloading while unresolved: the live count is "in progress" with its "may still change" note, never pass or fail', () => {
    const base = tripFor(TRIP_0040_ID)
    const arrival = phaseOf(base, 'arrival')
    const trip: Trip = {
      ...base,
      phases: base.phases.map(phase => phase.sequence_number <= arrival.sequence_number ? { ...phase, status: 'completed' as const, completed_at: SERVER_TIME } : phase),
      consignments: [consignment({ delivery_stop_id: phaseOf(base, 'unloading').trip_stop_id, parcel_count_expected: 7, scanned_in_count: 3 })],
    }

    renderTimeline(trip)

    const checked = zone('Unloading', 'Checked')
    expect(within(checked).getByText('Scan in progress')).toBeInTheDocument()
    expect(within(checked).getByText(/This count may still change/)).toBeInTheDocument()
    expect(within(checked).queryByText(/not scanned|All parcels scanned/)).not.toBeInTheDocument()
    expect(within(checked).getByText('Checks appear when the driver confirms unloading')).toBeInTheDocument()
  })

  it('confirmation: scanned out and in, the counts line, the driver\'s blind count and its note', () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const trip = closedTrip(
      { loading: { parcel_count_origin: 7 }, confirmation: { parcel_count_destination: 6, driver_visual_count: 6 } },
      { consignments: [consignment({ pickup_stop_id: loading.trip_stop_id })] },
    )

    renderTimeline(trip)

    const checked = zone('Confirmation', 'Checked')
    expect(within(checked).getByText(line('1 parcel unaccounted for'))).toBeInTheDocument()
    expect(within(checked).getByText(line('7 scanned out at origin, 6 scanned in at destination'))).toBeInTheDocument()
    expect(within(checked).getByText(CHECK_WORDING.counts.blindCountNote)).toBeInTheDocument()
    expect(within(zone('Confirmation', 'Recorded')).getByText(line('Driver counted 6 parcels'))).toBeInTheDocument()
  })

  it('location: the verdict as two lines in Checked, and the fixes, capture times, separation, boundary and map behind "Location details"', () => {
    const fixes = { driver_phone_lat: -33.9249, driver_phone_lng: 18.4241, horse_gps_lat: -33.9251, horse_gps_lng: 18.4243, pulsit_geofence_confirmed: true }

    renderTimeline(closedTrip({ departure: fixes }))

    const checked = zone('Departure', 'Checked')
    expect(checkLines(checked)).toEqual(['Truck within precinct tolerance'])
    fireEvent.click(within(checked).getByText('Location details'))
    for (const label of ['Driver phone capture time', 'Horse tracker capture time', 'Driver–truck separation', 'Boundary']) {
      expect(within(checked).getByText(label)).toBeInTheDocument()
    }
    expect(within(checked).getByRole('button', { name: VIEW_ON_MAP_LABEL })).toBeInTheDocument()
  })

  it('shows the truck geofence and the driver proximity as separate lines, and no "Location verified"', () => {
    const assessment = {
      proximity: 'separated', proximity_reasons: [], boundary: null, driver_fix: null, horse_fix: null,
    } as unknown as PhaseDescriptor['action_location_assessment']
    const trip = closedTrip({ departure: { pulsit_geofence_confirmed: true, action_location_assessment: assessment } })

    renderTimeline(trip)

    const checked = zone('Departure', 'Checked')
    expect(checkLines(checked)).toEqual(['Truck within precinct tolerance', 'Driver separated from truck'])
    expect(screen.queryByText(/Location verified/)).not.toBeInTheDocument()
  })

  it('override: the note and who authorised it are visible to everyone', () => {
    renderTimeline(closedTrip({ departure: { status: 'overridden', dispatcher_override_note: 'Driver phone lost', dispatcher_override_user_id: 'user-42' } }))

    const recorded = zone('Departure', 'Recorded')
    expect(within(recorded).getByText('Closed by dispatcher override')).toBeInTheDocument()
    expect(within(recorded).getByText('Driver phone lost')).toBeInTheDocument()
    expect(within(recorded).getByText(line('Authorised by user-42'))).toBeInTheDocument()
    expect(within(zone('Departure', 'Checked')).getByText('Checks bypassed')).toBeInTheDocument()
  })

  it('in transit: the named absence, and the recorded arrival location behind "Location details"', () => {
    const arrival = { driver_phone_lat: -33.9, driver_phone_lng: 18.4, horse_gps_lat: -33.9, horse_gps_lng: 18.4 }

    renderTimeline(closedTrip({ in_transit: arrival }))

    const checked = zone('In Transit', 'Checked')
    expect(within(checked).getByText(/Only recorded journey events are shown\./)).toBeInTheDocument()
    expect(within(checked).getByText('No location verdict is recorded for transit legs')).toBeInTheDocument()
    fireEvent.click(within(checked).getByText('Location details'))
    expect(within(checked).getByText('Recorded location at arrival')).toBeInTheDocument()
  })

  it('forensic mode: the receipt tag, the event hash and Verify', () => {
    forensic.forensicOn = true
    const departure = phaseOf(closedTrip(), 'departure')
    const trip = closedTrip(
      { departure: { event_hash: 'c'.repeat(64), blockchain_receipt_id: `receipt-${departure.phase_event_id}` } },
      { blockchain_receipts: [receiptFor(departure)] },
    )

    renderTimeline(trip)

    const audit = zone('Departure', 'Audit trail')
    expect(audit).toHaveTextContent('Pickup receipt anchored')
    expect(audit).toHaveTextContent('c'.repeat(64))
    expect(within(audit).getByTestId('verify-subject')).toHaveTextContent(departure.phase_event_id)
  })

  it('drops "No seal present" from an unresolved arrival: nothing is asserted absent before the driver records it', () => {
    renderTimeline(tripFor(TRIP_0040_ID))

    const row = phaseGroup('Arrival')
    expect(within(row).queryByText(/No seal present/)).not.toBeInTheDocument()
    expect(within(row).queryByText(/Condition as found/)).not.toBeInTheDocument()
    expect(within(row).getByText('Checks appear when the driver confirms arrival')).toBeInTheDocument()
  })
})

describe('TripTimeline: the override action', () => {
  it('stays below the zones on an unresolved phase, and is absent from a resolved one', () => {
    renderTimeline(tripFor(TRIP_0040_ID))

    const action = within(phaseGroup('Arrival')).getByRole('button', { name: 'Record as unable to complete' })
    const checked = zone('Arrival', 'Checked')
    // Document order: the action comes after the last zone, never between zones.
    expect(checked.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(phaseGroup('Loading')).queryByRole('button', { name: 'Record as unable to complete' })).not.toBeInTheDocument()
    fireEvent.click(toggleOf('Loading')!)
    expect(within(phaseGroup('Loading')).queryByRole('button', { name: 'Record as unable to complete' })).not.toBeInTheDocument()
  })
})

describe('TripTimeline: who sees the anchor', () => {
  function trippedAnchor(status: PhaseDescriptor['anchor_status']): { trip: Trip; departure: PhaseDescriptor } {
    const departure = phaseOf(closedTrip(), 'departure')
    const trip = closedTrip(
      { departure: { anchor_status: status, event_hash: 'd'.repeat(64), blockchain_receipt_id: `receipt-${departure.phase_event_id}` } },
      { blockchain_receipts: [receiptFor(departure)] },
    )
    return { trip, departure }
  }

  it('shows no anchor row, no Audit trail, no receipt, hash or Verify with forensic mode off', () => {
    forensic.forensicOn = false
    renderTimeline(trippedAnchor('anchored').trip)

    const row = openCard('Departure')
    expect(within(row).queryByRole('region', { name: 'Audit trail' })).not.toBeInTheDocument()
    expect(within(row).queryByText(/Anchored|Anchoring/)).not.toBeInTheDocument()
    expect(row).not.toHaveTextContent('Pickup receipt anchored')
    expect(row).not.toHaveTextContent('d'.repeat(64))
    expect(within(row).queryByTestId('verify-subject')).not.toBeInTheDocument()
  })

  it('shows the anchor row and the Audit trail with forensic mode on', () => {
    forensic.forensicOn = true
    renderTimeline(trippedAnchor('anchored').trip)

    const row = openCard('Departure')
    expect(within(row).getByRole('region', { name: 'Audit trail' })).toBeInTheDocument()
    expect(within(zone('Departure', 'Recorded')).getByText(/^Anchored /)).toBeInTheDocument()
  })

  it('keeps "Anchor failed, receipt still owed" visible to everyone, outside the verdict', () => {
    forensic.forensicOn = false
    renderTimeline(trippedAnchor('failed').trip)

    const row = phaseGroup('Departure')
    expect(within(row).getByText('Anchor failed, receipt still owed')).toBeInTheDocument()
    expect(within(row).queryByText(/Needs attention/)).not.toBeInTheDocument()
  })
})

const ANCHORED_PHASES: readonly string[] = ['Activation', 'Loading', 'Departure', 'In Transit', 'Arrival', 'Unloading', 'Confirmation']

/** Every phase resolved and anchored, each with its own receipt, event hash and (for departure)
 *  a cited seal photo carrying a capture position and a file hash. */
function anchoredTrip(): { trip: Trip; artifacts: Map<string, EvidenceArtifactWithUrl> } {
  const base = closedTrip()
  const withEvidence = base.phases.map(phase => phase.phase_type === 'trip_creation' ? phase : {
    ...phase,
    anchor_status: 'anchored' as const,
    event_hash: `${phase.sequence_number}`.repeat(64).slice(0, 64),
    blockchain_receipt_id: `receipt-${phase.phase_event_id}`,
    seal_photo_artifact_id: phase.phase_type === 'departure' ? 'seal-1' : phase.seal_photo_artifact_id,
  })
  const trip: Trip = {
    ...base,
    phases: withEvidence,
    blockchain_receipts: withEvidence.filter(phase => phase.phase_type !== 'trip_creation').map(receiptFor),
  }
  const seal = artifact('seal-1', phaseOf(base, 'departure').phase_event_id, 'seal_photo', { captured_lat: -33.92491, captured_lng: 18.42411, file_hash: 'e'.repeat(64) })
  return { trip, artifacts: artifactMap(seal) }
}

describe('TripTimeline: forensic gating (D32)', () => {
  it.each([
    ['forensic mode is off', true, false],
    ['the dispatcher is not an admin', false, true],
  ] as const)('shows no anchor row, Audit trail, receipt, hash, Verify or photo provenance on any phase when %s', (_case, canView, on) => {
    forensic.canViewForensics = canView
    forensic.forensicOn = on
    const { trip, artifacts } = anchoredTrip()
    renderTimeline(trip, { artifactsById: artifacts })

    for (const name of ANCHORED_PHASES) {
      const row = openCard(name)
      expect(within(row).queryByRole('region', { name: 'Audit trail' })).not.toBeInTheDocument()
      expect(within(row).queryByText(/Anchored|Anchoring/)).not.toBeInTheDocument()
      expect(within(row).queryByTestId('verify-subject')).not.toBeInTheDocument()
      expect(row).not.toHaveTextContent(/receipt anchored/i)
    }
    expect(document.body.textContent).not.toMatch(/SHA-256|Event hash/)
    expect(document.body.textContent).not.toContain('-33.92491')
    expect(document.body.textContent).not.toContain('e'.repeat(64))
  })

  it('shows the anchor row, Audit trail, receipt, event hash and Verify on every anchored phase with forensic mode on', () => {
    forensic.forensicOn = true
    const { trip, artifacts } = anchoredTrip()
    renderTimeline(trip, { artifactsById: artifacts })

    for (const name of ANCHORED_PHASES) {
      const row = openCard(name)
      const audit = within(row).getByRole('region', { name: 'Audit trail' })
      expect(audit).toHaveTextContent('Pickup receipt anchored')
      expect(audit).toHaveTextContent('Event hash')
      expect(within(audit).getByTestId('verify-subject')).toBeInTheDocument()
      expect(within(zone(name, 'Recorded')).getByText(/^Anchored /)).toBeInTheDocument()
    }
    expect(document.body.textContent).toContain('SHA-256')
    expect(document.body.textContent).toContain('-33.92491')
  })

  it('keeps the override note and who authorised it visible with forensic mode off', () => {
    forensic.forensicOn = false
    renderTimeline(closedTrip({ departure: { status: 'overridden', dispatcher_override_note: 'Driver phone lost', dispatcher_override_user_id: 'user-42' } }))

    const recorded = zone('Departure', 'Recorded')
    expect(within(recorded).getByText('Driver phone lost')).toBeInTheDocument()
    expect(within(recorded).getByText(line('Authorised by user-42'))).toBeInTheDocument()
    expect(within(phaseGroup('Departure')).queryByRole('region', { name: 'Audit trail' })).not.toBeInTheDocument()
  })

  it('keeps "Anchor failed, receipt still owed" visible with forensic mode off, on every phase that failed', () => {
    forensic.forensicOn = false
    renderTimeline(closedTrip({ departure: { anchor_status: 'failed' }, loading: { anchor_status: 'failed' } }))

    expect(within(phaseGroup('Departure')).getByText('Anchor failed, receipt still owed')).toBeInTheDocument()
    expect(within(phaseGroup('Loading')).getByText('Anchor failed, receipt still owed')).toBeInTheDocument()
  })

  it('gates by wrapping in ForensicOnly, never by a prop a caller could forget', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const read = (file: string): string => readFileSync(resolve(root, file), 'utf8')
    // A prop, parameter or variable named after forensic mode would be a gate that can be passed wrongly.
    const FLAG = /\bforensic\w*\s*[?:=]/i
    for (const file of ['domain/PhaseActs.tsx', 'domain/PhaseActRow.tsx', 'domain/PhaseAudit.tsx', 'trips/PhaseCardBody.tsx', 'trips/TimelinePhase.tsx']) {
      expect(read(file), file).not.toMatch(FLAG)
    }
    expect(read('domain/PhaseAudit.tsx')).toMatch(/<ForensicOnly>[\s\S]*<\/ForensicOnly>/)
    expect(read('domain/PhaseActRow.tsx')).toMatch(/<ForensicOnly><RailRow kind="anchor"/)
  })
})

describe('TripTimeline: what each phase type can show (design note §7.2)', () => {
  it.each(['Activation', 'In Transit', 'Unloading'] as const)('never shows a photo or an "Expected: photo" row on %s', name => {
    renderTimeline(closedTrip())

    const row = openCard(name)
    expect(within(row).queryByRole('img')).not.toBeInTheDocument()
    expect(within(row).queryByText(/Expected: .*photo/)).not.toBeInTheDocument()
    expect(within(row).queryByText(/photographed|photo taken/)).not.toBeInTheDocument()
  })

  it('records an absent row on a resolved departure with no cited seal photo', () => {
    renderTimeline(closedTrip({ departure: { seal_number: 'FP-1' } }))

    expect(within(zone('Departure', 'Recorded')).getByText('No seal photo submitted at completion')).toBeInTheDocument()
  })

  it('records no absent row, and an expected row instead, on an active departure', () => {
    const base = tripFor(TRIP_0040_ID)
    const departure = phaseOf(base, 'departure')
    const trip: Trip = {
      ...base,
      phases: base.phases.map(phase => phase.sequence_number >= departure.sequence_number
        ? { ...phase, status: 'pending' as const, completed_at: null, seal_number: null } : phase),
    }

    renderTimeline(trip)

    const recorded = zone('Departure', 'Recorded')
    expect(within(recorded).queryByText(/submitted at completion/)).not.toBeInTheDocument()
    expect(within(recorded).getByText('Expected: seal photo')).toBeInTheDocument()
    expect(within(recorded).getByText('Waiting for the driver to confirm departure')).toBeInTheDocument()
  })

  it('words the receiver row by provenance and never writes Ed25519', () => {
    const base = closedTrip()
    const confirmation = phaseOf(base, 'confirmation')
    const signature = artifact('sig', confirmation.phase_event_id, 'pod_signature', { artifact_type: 'document', mime_type: 'image/png', captured_by_driver_id: null })
    const photo = artifact('pod', confirmation.phase_event_id, 'pod_photo')
    const trip = closedTrip({ confirmation: { pod_signature_artifact_id: 'sig', pod_photo_artifact_id: 'pod' } })

    renderTimeline(trip, { artifactsById: artifactMap(signature, photo) })

    const recorded = zone('Confirmation', 'Recorded')
    expect(within(recorded).getByText('Receiver confirmed delivery · Attestation image')).toBeInTheDocument()
    expect(within(recorded).getByText('Proof-of-delivery photo taken')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ed25519/i)
  })

  it('words an unattributed receiver artifact as "Submitted as receiver confirmation"', () => {
    const signature = artifact('sig', null, null, { artifact_type: 'document', mime_type: 'image/png' })
    const trip = closedTrip({ confirmation: { pod_signature_artifact_id: 'sig' } })

    renderTimeline(trip, { artifactsById: artifactMap(signature) })

    expect(within(zone('Confirmation', 'Recorded')).getByText('Submitted as receiver confirmation')).toBeInTheDocument()
    expect(screen.queryByText(/Receiver confirmed delivery/)).not.toBeInTheDocument()
  })

  it('groups several uploads for one role under "{n} photos uploaded" with "+n more"', () => {
    const base = tripFor(TRIP_0040_ID)
    const departure = phaseOf(base, 'departure')
    const trip: Trip = {
      ...base,
      phases: base.phases.map(phase => phase.sequence_number >= departure.sequence_number
        ? { ...phase, status: 'pending' as const, completed_at: null } : phase),
    }
    const uploads = ['u1', 'u2', 'u3'].map(id => artifact(id, departure.phase_event_id, 'seal_photo'))

    renderTimeline(trip, { artifactsById: artifactMap(...uploads) })

    const recorded = zone('Departure', 'Recorded')
    expect(within(recorded).getByText(line('3 photos uploaded'))).toBeInTheDocument()
    expect(within(recorded).getByRole('button', { name: '+2 more' })).toBeInTheDocument()
    expect(within(recorded).getAllByRole('img')).toHaveLength(1)
  })

  it('offers the linehaul PDF as a document to open, never as an image', () => {
    const trip = closedTrip({ loading: { linehaul_photo_artifact_id: 'sheet', linehaul_pdf_artifact_id: 'pdf', parcel_count_origin: 16 } })
    const loading = phaseOf(trip, 'loading')
    const sheet = artifact('sheet', loading.phase_event_id, 'linehaul_photo')
    const pdf = artifact('pdf', loading.phase_event_id, 'linehaul_pdf', { artifact_type: 'document', mime_type: 'application/pdf', signed_url: 'https://example.test/pdf.pdf' })

    renderTimeline(trip, { artifactsById: artifactMap(sheet, pdf) })

    const recorded = zone('Loading', 'Recorded')
    expect(within(recorded).getByText('Linehaul sheet scanned (PDF)')).toBeInTheDocument()
    expect(within(recorded).getAllByRole('img')).toHaveLength(1)
    expect(within(recorded).getByRole('link', { name: 'Open ↗' })).toHaveAttribute('href', 'https://example.test/pdf.pdf')
    expect(within(recorded).queryByText('Image failed to load')).not.toBeInTheDocument()
  })

  it('counts several linehaul PDFs as files, not photos', () => {
    const base = tripFor(TRIP_0040_ID)
    const loading = phaseOf(base, 'loading')
    const trip: Trip = {
      ...base,
      phases: base.phases.map(phase => phase.sequence_number >= loading.sequence_number
        ? { ...phase, status: 'pending' as const, completed_at: null } : phase),
    }
    const uploads = ['p1', 'p2'].map(id => artifact(id, loading.phase_event_id, 'linehaul_pdf', { artifact_type: 'document', mime_type: 'application/pdf' }))

    renderTimeline(trip, { artifactsById: artifactMap(...uploads) })

    const recorded = zone('Loading', 'Recorded')
    expect(within(recorded).getByText(line('2 files uploaded'))).toBeInTheDocument()
    expect(within(recorded).queryByText(/photos uploaded/)).not.toBeInTheDocument()
    expect(within(recorded).queryByRole('img')).not.toBeInTheDocument()
  })

  it('counts several linehaul PDFs as files on the collapsed card row', () => {
    const trip = closedTrip({ loading: { linehaul_photo_artifact_id: 'sheet', linehaul_pdf_artifact_id: 'p1', parcel_count_origin: 16 } })
    const loading = phaseOf(trip, 'loading')
    const sheet = artifact('sheet', loading.phase_event_id, 'linehaul_photo')
    const pdfs = ['p1', 'p2'].map(id => artifact(id, loading.phase_event_id, 'linehaul_pdf', { artifact_type: 'document', mime_type: 'application/pdf' }))

    renderTimeline(trip, { artifactsById: artifactMap(sheet, ...pdfs) })

    const rows = within(phaseGroup('Loading')).getAllByRole('listitem')
    const pdfRow = rows.find(row => row.textContent?.includes('Linehaul sheet scanned (PDF)'))
    expect(pdfRow).toHaveTextContent('2 files uploaded')
    expect(pdfRow).not.toHaveTextContent('photos')
  })

  it('still names a submitted photo whose metadata failed to load, as "Recorded artifact unavailable"', () => {
    const trip = closedTrip({ departure: { seal_number: 'FP-1', seal_photo_artifact_id: 'gone' } })

    renderTimeline(trip, { artifactsById: NO_ARTIFACTS })

    const recorded = zone('Departure', 'Recorded')
    expect(within(recorded).getByText('Seal photographed')).toBeInTheDocument()
    expect(within(recorded).getByText('Submitted at completion')).toBeInTheDocument()
    expect(within(recorded).getByText('Recorded artifact unavailable')).toBeInTheDocument()
    expect(within(recorded).queryByText('No seal photo submitted at completion')).not.toBeInTheDocument()
  })

  it('updates silently when a late upload lands on a resolved phase', () => {
    const trip = closedTrip({ departure: { seal_number: 'FP-1' } })
    const departure = phaseOf(trip, 'departure')
    const { rerender } = renderTimeline(trip)
    openCard('Departure')

    const late = artifact('late', departure.phase_event_id, 'seal_photo', { created_at: '2026-05-04T08:00:00Z' })
    rerender(<TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} artifactsById={artifactMap(late)} />)

    expect(within(zone('Departure', 'Recorded')).getByText('Received after the phase closed')).toBeInTheDocument()
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull()
  })
})

describe('TripTimeline: a cancelled trip', () => {
  function cancelledTrip(): { trip: Trip; departure: PhaseDescriptor } {
    const base = tripFor(TRIP_0041_ID)
    const departure = phaseOf(base, 'departure')
    const trip: Trip = {
      ...base,
      status: 'cancelled',
      closed_at: '2026-05-09T09:00:00Z',
      phases: base.phases.map(phase => phase.sequence_number >= departure.sequence_number
        ? { ...phase, status: 'pending' as const, completed_at: null } : phase),
      exceptions: [exception('cx', { phase_event_id: departure.phase_event_id, description: 'Cancelled-trip exception' })],
    }
    return { trip, departure }
  }

  it('keeps the unfinished phase\'s uploads and exceptions, with no waiting rows, no verdict and no highlight', () => {
    const { trip, departure } = cancelledTrip()
    const upload = artifact('up', departure.phase_event_id, 'seal_photo', { created_at: '2026-05-09T08:30:00Z' })

    renderTimeline(trip, { artifactsById: artifactMap(upload) })

    const row = openCard('Departure')
    expect(within(row).getByText('Seal photographed')).toBeInTheDocument()
    expect(within(row).getByText('Not submitted: trip cancelled')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Route Deviation/ })).toBeInTheDocument()
    expect(within(row).queryByText(/Expected:|Waiting for the/)).not.toBeInTheDocument()
    expect(within(row).getByText('Not reached')).toBeInTheDocument()
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull()
  })

  // The phase is the first unresolved one, carrying an exception so that a cancelled trip still has
  // a card to open (a cancelled phase with nothing recorded has no body at all).
  function stalledTrip(type: 'loading' | 'unloading', status: Trip['status']): Trip {
    const base = tripFor(TRIP_0040_ID)
    const target = phaseOf(base, type)
    const counts = type === 'loading'
      ? consignment({ pickup_stop_id: target.trip_stop_id, parcel_count_expected: 7, scanned_out_count: 3 })
      : consignment({ delivery_stop_id: target.trip_stop_id, parcel_count_expected: 7, scanned_in_count: 3 })
    return {
      ...base,
      status,
      closed_at: status === 'cancelled' ? '2026-05-09T09:00:00Z' : null,
      consignments: [counts],
      exceptions: [exception('stalled', { phase_event_id: target.phase_event_id })],
      // Everything before the target is done, so the target is the plan's first unresolved phase.
      phases: base.phases.map(phase => phase.sequence_number >= target.sequence_number
        ? { ...phase, status: 'pending' as const, completed_at: null }
        : { ...phase, status: 'completed' as const, completed_at: phase.completed_at ?? SERVER_TIME }),
    }
  }

  it.each([['loading', 'Loading'], ['unloading', 'Unloading']] as const)(
    'shows no live scan line and no "Checks appear" note on a cancelled trip\'s unfinished %s, once its card is open',
    (type, name) => {
      renderTimeline(stalledTrip(type, 'cancelled'))

      const row = openCard(name)
      expect(within(row).getByRole('region', { name: 'Recorded' })).toBeInTheDocument()
      expect(within(row).queryByText('Scan in progress')).not.toBeInTheDocument()
      expect(within(row).queryByText(/Checks appear when/)).not.toBeInTheDocument()
      expect(within(row).queryByRole('region', { name: 'Checked' })).not.toBeInTheDocument()
    },
  )

  it.each([['loading', 'Loading'], ['unloading', 'Unloading']] as const)(
    'control: the same %s on a running trip does show the live scan line',
    (type, name) => {
      renderTimeline(stalledTrip(type, 'active'))

      const checked = zone(name, 'Checked')
      expect(within(checked).getByText('Scan in progress')).toBeInTheDocument()
      expect(within(checked).getByText(/Checks appear when/)).toBeInTheDocument()
    },
  )

  it('shows no "Seal not inspected" line on a cancelled trip\'s unreached leg, once its card is open; a running leg shows it', () => {
    const base = tripFor(TRIP_0041_ID)
    const transit = phaseOf(base, 'in_transit')
    const withException = (status: Trip['status']): Trip => ({
      ...base, status, closed_at: status === 'cancelled' ? '2026-05-09T09:00:00Z' : null,
      exceptions: [exception('leg', { phase_event_id: transit.phase_event_id })],
    })

    const cancelled = renderTimeline(withException('cancelled'))
    const row = openCard('In Transit')
    expect(within(row).getByRole('region', { name: 'Recorded' })).toBeInTheDocument()
    expect(within(row).queryByText(/Seal not inspected/)).not.toBeInTheDocument()
    cancelled.unmount()

    renderTimeline(withException('active'))
    expect(within(zone('In Transit', 'Checked')).getByText('Seal not inspected yet')).toBeInTheDocument()
  })

  it('shows an en-route leg\'s exceptions on a cancelled trip', () => {
    const base = tripFor(TRIP_0041_ID)
    const transit = phaseOf(base, 'in_transit')
    const trip: Trip = {
      ...base, status: 'cancelled', closed_at: '2026-05-09T09:00:00Z',
      exceptions: [exception('en-route', { phase_event_id: transit.phase_event_id, description: 'Left the corridor' })],
    }

    renderTimeline(trip)

    expect(within(phaseGroup('In Transit')).getByRole('button', { name: /Route Deviation/ })).toBeInTheDocument()
    expect(within(openCard('In Transit')).queryByText(/Seal not inspected/)).not.toBeInTheDocument()
  })
})

describe('TripTimeline: the in-transit leg', () => {
  const NOW = '2026-05-09T11:22:00Z'

  it('ticks "time on the road" once a minute on the live leg, and labels where it left from', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))

    renderTimeline(tripFor(TRIP_0041_ID))

    const row = phaseGroup('In Transit')
    expect(within(row).getByText(line(/Departed 10:10 SAST/))).toBeInTheDocument()
    expect(within(row).getByText(line(/3\s+h\s+12\s+m on the road/))).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(60_000) })

    expect(within(row).getByText(line(/3\s+h\s+13\s+m on the road/))).toBeInTheDocument()
  })

  it('records the departure with its seal, the dashed en-route rows, and the standing seal line', () => {
    renderTimeline(tripFor(TRIP_0041_ID))

    const recorded = zone('In Transit', 'Recorded')
    expect(within(recorded).getByText(/^Departed /)).toBeInTheDocument()
    expect(within(recorded).getByText(line('Sealed FP-3456 at departure'))).toBeInTheDocument()
    expect(within(recorded).getByText(/^En route to /)).toBeInTheDocument()
    expect(within(recorded).getByText('Waiting for the driver to confirm arrival')).toBeInTheDocument()
    const checked = zone('In Transit', 'Checked')
    expect(within(checked).getByText('Seal not inspected yet')).toBeInTheDocument()
  })

  it('keeps the live leg open with no toggle, as before', () => {
    renderTimeline(tripFor(TRIP_0041_ID))

    expect(toggleOf('In Transit')).toBeNull()
  })

  it('offers a current-leg strip only after its active row leaves the timeline scroller', () => {
    let notify: ((entries: IntersectionObserverEntry[]) => void) | undefined
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void) { notify = callback }
      observe = vi.fn(); disconnect = vi.fn(); unobserve = vi.fn(); takeRecords = () => []
      root = null; rootMargin = ''; thresholds = []
    })
    const onJump = vi.fn()
    render(<div data-timeline-scroller><TripTimeline trip={tripFor(TRIP_0041_ID)} precincts={mockPrecincts} lastUpdated={null} onJump={onJump} {...evidence} /></div>)

    expect(screen.queryByRole('button', { name: 'Show current leg' })).not.toBeInTheDocument()
    act(() => notify?.([{ isIntersecting: false } as IntersectionObserverEntry]))
    fireEvent.click(screen.getByRole('button', { name: 'Show current leg' }))

    expect(onJump).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('scopes each transit leg\'s exceptions to that leg by phase id', () => {
    const base = closedTrip()
    const only = phaseOf(base, 'in_transit')
    renderTimeline({ ...base, exceptions: [exception('leg', { phase_event_id: only.phase_event_id, severity: 'critical', exception_type: 'tracker_silent' }), exception('other', { phase_event_id: null, exception_type: 'dispatcher_note' })] })

    const row = openCard('In Transit')
    expect(within(row).getAllByRole('button', { name: /Tracker silent/ })).toHaveLength(1)
    expect(within(row).queryByRole('button', { name: /Dispatcher Note/ })).not.toBeInTheDocument()
  })
})

describe('TripTimeline: the in-transit card is always open once the leg has started (D31)', () => {
  const noToggle = (name: string): void => {
    const row = phaseGroup(name)
    expect(toggleOf(name)).toBeNull()
    expect(within(row).queryAllByRole('button', { expanded: false })).toHaveLength(0)
    expect(within(row).queryAllByRole('button', { expanded: true })).toHaveLength(0)
    expect(within(row).getByRole('region', { name: 'Recorded' })).toBeInTheDocument()
  }

  it.each([
    ['completed', 'completed'],
    ['exception', 'exception'],
    ['overridden', 'overridden'],
  ] as const)('is open with no toggle and no chevron on a %s leg', (_label, status) => {
    renderTimeline(closedTrip({ in_transit: { status, dispatcher_override_note: status === 'overridden' ? 'Phone lost' : null } }))

    noToggle('In Transit')
  })

  it('is open with no toggle on the active leg', () => {
    renderTimeline(tripFor(TRIP_0041_ID))

    noToggle('In Transit')
  })

  it('shows a finished leg\'s exception rows once, in the rail, and its Checked zone', () => {
    const base = closedTrip()
    const leg = phaseOf(base, 'in_transit')
    renderTimeline({ ...base, exceptions: [exception('leg-1', { phase_event_id: leg.phase_event_id, exception_type: 'tracker_silent' })] })

    expect(within(phaseGroup('In Transit')).getAllByRole('button', { name: /Tracker silent/ })).toHaveLength(1)
    expect(within(phaseGroup('In Transit')).getByRole('region', { name: 'Recorded' })).toContainElement(
      within(phaseGroup('In Transit')).getByRole('button', { name: /Tracker silent/ }),
    )
    expect(within(phaseGroup('In Transit')).getByRole('region', { name: 'Checked' })).toBeInTheDocument()
  })

  it('keeps every other resolved phase collapsed by default', () => {
    renderTimeline(closedTrip())

    for (const name of ['Activation', 'Loading', 'Departure', 'Arrival', 'Unloading', 'Confirmation']) {
      expect(toggleOf(name)).toHaveAttribute('aria-expanded', 'false')
    }
  })

  it('leaves a leg that has not started as a collapsed "Not started" card with nothing in it', () => {
    const base = tripFor(TRIP_0041_ID)
    const departure = phaseOf(base, 'departure')
    const trip: Trip = {
      ...base,
      phases: base.phases.map(phase => phase.sequence_number >= departure.sequence_number
        ? { ...phase, status: 'pending' as const, completed_at: null } : phase),
    }

    renderTimeline(trip)

    const row = phaseGroup('In Transit')
    expect(within(row).getByText('Not started')).toBeInTheDocument()
    expect(toggleOf('In Transit')).toBeNull()
    expect(within(row).queryByRole('region')).not.toBeInTheDocument()
  })

  it('leaves a leg a cancelled trip never reached as a collapsed "Not reached" card', () => {
    const base = tripFor(TRIP_0041_ID)
    const trip: Trip = { ...base, status: 'cancelled', closed_at: '2026-05-09T09:00:00Z', exceptions: [] }

    renderTimeline(trip)

    const row = phaseGroup('In Transit')
    expect(within(row).getByText('Not reached')).toBeInTheDocument()
    expect(within(row).queryByRole('region')).not.toBeInTheDocument()
  })

  it('opens every in_transit leg of a 13-phase cross-dock, and renders one current card', () => {
    const base = tripFor(TRIP_0041_ID)
    const plan: PhaseType[] = [
      'trip_creation', 'activation', 'loading', 'departure', 'in_transit', 'arrival', 'unloading',
      'loading', 'departure', 'in_transit', 'arrival', 'unloading', 'confirmation',
    ]
    const firstOpen = plan.lastIndexOf('in_transit')
    const template = (type: PhaseType): PhaseDescriptor => base.phases.find(phase => phase.phase_type === type)!
    const phases: PhaseDescriptor[] = plan.map((type, index) => ({
      ...template(type), phase_event_id: `cd-${index}` as PhaseEventId, sequence_number: index,
      status: index < firstOpen ? 'completed' : 'pending', completed_at: index < firstOpen ? SERVER_TIME : null,
    }))

    const { container } = renderTimeline({ ...base, phases, exceptions: [] })

    expect(container.querySelectorAll('[data-node-type="next"]')).toHaveLength(1)
    const legs = screen.getAllByRole('group', { name: /^In Transit phase/ })
    expect(legs).toHaveLength(2)
    for (const leg of legs) {
      expect(within(leg).queryAllByRole('button', { expanded: false })).toHaveLength(0)
      expect(within(leg).getByRole('region', { name: 'Recorded' })).toBeInTheDocument()
    }
  })
})

describe('TripTimeline: the side-by-side split (D30)', () => {
  // A ResizeObserver on the card body is the only thing that may decide the layout: these tests
  // drive it by hand and never touch the viewport.
  const observers: Array<{ callback: ResizeObserverCallback }> = []

  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.push(this) }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function resizeTo(width: number): void {
    act(() => {
      for (const observer of observers) observer.callback([{ contentRect: { width } } as ResizeObserverEntry], observer as unknown as ResizeObserver)
    })
  }

  const layoutOf = (name: string): string | null => phaseGroup(name).querySelector('[data-layout]')?.getAttribute('data-layout') ?? null
  const withCheck = (): Trip => closedTrip({ departure: { pulsit_geofence_confirmed: true } })

  it.each([[772, 'split'], [676, 'stacked'], [564, 'stacked']] as const)('lays a card with a check out %s px wide as %s', (width, layout) => {
    renderTimeline(withCheck())
    openCard('Departure')

    resizeTo(width)

    expect(layoutOf('Departure')).toBe(layout)
  })

  it('stacks before it has measured anything', () => {
    renderTimeline(withCheck())
    openCard('Departure')

    expect(layoutOf('Departure')).toBe('stacked')
  })

  it('splits at exactly 740 px and not at 739', () => {
    renderTimeline(withCheck())
    openCard('Departure')

    resizeTo(740)
    expect(layoutOf('Departure')).toBe('split')
    resizeTo(739)
    expect(layoutOf('Departure')).toBe('stacked')
  })

  it('puts Recorded and Checked in one row when split, with Audit trail below both', () => {
    forensic.forensicOn = true
    const departure = phaseOf(closedTrip(), 'departure')
    renderTimeline(closedTrip({ departure: { pulsit_geofence_confirmed: true, event_hash: 'c'.repeat(64), blockchain_receipt_id: `receipt-${departure.phase_event_id}` } },
      { blockchain_receipts: [receiptFor(departure)] }))
    const row = openCard('Departure')

    resizeTo(772)

    const recorded = within(row).getByRole('region', { name: 'Recorded' })
    const checked = within(row).getByRole('region', { name: 'Checked' })
    const audit = within(row).getByRole('region', { name: 'Audit trail' })
    expect(recorded.parentElement).toBe(checked.parentElement?.parentElement)
    expect(recorded.parentElement).toHaveClass('grid')
    expect(recorded.parentElement).not.toContainElement(audit)
    expect(recorded.compareDocumentPosition(audit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not count a live scan line as a check: an unloading still scanning stacks at any width', () => {
    const base = tripFor(TRIP_0040_ID)
    const arrival = phaseOf(base, 'arrival')
    const trip: Trip = {
      ...base,
      phases: base.phases.map(phase => phase.sequence_number <= arrival.sequence_number ? { ...phase, status: 'completed' as const, completed_at: SERVER_TIME } : phase),
      consignments: [consignment({ delivery_stop_id: phaseOf(base, 'unloading').trip_stop_id, parcel_count_expected: 7, scanned_in_count: 3 })],
    }
    renderTimeline(trip)
    expect(within(zone('Unloading', 'Checked')).getByText('Scan in progress')).toBeInTheDocument()

    resizeTo(1200)

    expect(layoutOf('Unloading')).toBe('stacked')
  })

  it('never splits a card with nothing in Checked yet, however wide', () => {
    renderTimeline(tripFor(TRIP_0040_ID))

    resizeTo(1200)

    expect(layoutOf('Arrival')).toBe('stacked')
  })

  it('stacks an in_transit card at any width', () => {
    renderTimeline(closedTrip())

    resizeTo(1200)

    expect(layoutOf('In Transit')).toBe('stacked')
  })

  it('does not read the viewport: a wide window with a narrow card still stacks', () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 })
    try {
      renderTimeline(withCheck())
      openCard('Departure')

      resizeTo(564)

      expect(layoutOf('Departure')).toBe('stacked')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })
})

describe('TripTimeline: facts shown once, and cards that stay put', () => {
  it('does not invent an arrival for an overridden leg: no "Arrived", the override says what happened', () => {
    renderTimeline(closedTrip({ in_transit: { status: 'overridden', dispatcher_override_note: 'Driver phone lost', dispatcher_override_user_id: 'user-9' } }))

    const row = phaseGroup('In Transit')
    expect(within(row).queryByText(/Arrived/)).not.toBeInTheDocument()
    expect(within(row).getAllByText('Closed by dispatcher override').length).toBeGreaterThan(0)
    expect(within(row).getByText('Driver phone lost')).toBeInTheDocument()
  })

  it('shows a completed leg\'s departure and arrival once each across the whole timeline', () => {
    renderTimeline(closedTrip())

    expect(screen.getAllByText(/^Departed /)).toHaveLength(1)
    expect(screen.getAllByText(/^Reached /)).toHaveLength(1)
  })

  it('leaves a card collapsed and unhighlighted when the reveal request is addressed to another phase', async () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const departure = phaseOf(base, 'departure')
    const trip = { ...base, exceptions: [
      exception('on-loading', { phase_event_id: loading.phase_event_id }),
      exception('on-departure', { phase_event_id: departure.phase_event_id }),
    ] }
    const onRevealHandled = vi.fn()

    renderTimeline(trip, { revealRequest: { exceptionId: 'on-departure', phaseId: departure.phase_event_id, requestId: 1 }, onRevealHandled })

    await waitFor(() => expect(onRevealHandled).toHaveBeenCalledWith(exceptionRowId('on-departure')))
    expect(toggleOf('Departure')).toHaveAttribute('aria-expanded', 'true')
    expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'false')
    const loadingRow = within(phaseGroup('Loading')).getByRole('button', { name: /Route Deviation/ })
    expect(loadingRow).not.toHaveAttribute('data-highlighted')
    expect(loadingRow).not.toHaveFocus()
  })

  it('keeps an opened card, and its exception rows, across a refetch with a new trip object', () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const trip = { ...base, exceptions: [exception('a', { phase_event_id: loading.phase_event_id }), exception('b', { phase_event_id: loading.phase_event_id })] }
    const { rerender } = renderTimeline(trip, { lastUpdated: 1 })
    fireEvent.click(toggleOf('Loading')!)
    expect(within(zone('Loading', 'Recorded')).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(2)

    rerender(<TripTimeline trip={{ ...trip, exceptions: [...trip.exceptions] }} precincts={mockPrecincts} lastUpdated={2} onJump={vi.fn()} {...evidence} />)

    expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'true')
    expect(within(zone('Loading', 'Recorded')).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(2)
    expect(within(phaseGroup('Loading')).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(2)
  })
})

describe('TripTimeline: exception rows', () => {
  function tripWithLoadingExceptions(count: number): { trip: Trip; ids: string[] } {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const ids = Array.from({ length: count }, (_unused, index) => `ex-${index + 1}`)
    const exceptions = ids.map((id, index) => exception(id, {
      phase_event_id: loading.phase_event_id, created_at: `2026-05-03T0${index + 1}:00:00Z`, description: `Row ${id}`,
    }))
    return { trip: { ...base, exceptions }, ids }
  }

  const rowButtons = (): HTMLElement[] => within(phaseGroup('Loading')).queryAllByRole('button', { name: /Route Deviation/ })

  it('shows a collapsed card\'s exception rows under its verdict, and the same rows in the rail once opened, never both', () => {
    renderTimeline(tripWithLoadingExceptions(2).trip)

    expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'false')
    expect(rowButtons()).toHaveLength(2)

    fireEvent.click(toggleOf('Loading')!)

    expect(rowButtons()).toHaveLength(2)
    const recorded = within(phaseGroup('Loading')).getByRole('region', { name: 'Recorded' })
    expect(within(recorded).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(2)
  })

  it('caps a card at three rows plus one "+n more" row, collapsed and open', () => {
    renderTimeline(tripWithLoadingExceptions(5).trip)

    expect(rowButtons()).toHaveLength(3)
    expect(within(phaseGroup('Loading')).getAllByRole('button', { name: /\+2 more/ })).toHaveLength(1)

    fireEvent.click(toggleOf('Loading')!)

    expect(rowButtons()).toHaveLength(3)
    expect(within(phaseGroup('Loading')).getAllByRole('button', { name: /\+2 more/ })).toHaveLength(1)
  })

  it('opens the exception, with its phase, from a click and from Enter and Space', async () => {
    const onOpenException = vi.fn()
    const { trip } = tripWithLoadingExceptions(1)
    const loading = phaseOf(trip, 'loading')
    renderTimeline(trip, { onOpenException })

    const row = rowButtons()[0]!
    await userEvent.click(row)
    expect(onOpenException).toHaveBeenLastCalledWith('ex-1', loading.phase_event_id)

    row.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onOpenException).toHaveBeenCalledTimes(3)
  })

  it('opens the phase\'s records in the panel from "+n more", with no single exception selected', async () => {
    const onOpenException = vi.fn()
    const { trip } = tripWithLoadingExceptions(5)
    renderTimeline(trip, { onOpenException })

    await userEvent.click(within(phaseGroup('Loading')).getByRole('button', { name: /\+2 more/ }))

    expect(onOpenException).toHaveBeenCalledWith(null, phaseOf(trip, 'loading').phase_event_id)
  })

  it('never renders the full exception card on the timeline, and PhaseExceptionGroup is gone', () => {
    renderTimeline(tripWithLoadingExceptions(2).trip)

    expect(document.querySelector('article')).toBeNull()
    expect(screen.queryByRole('group', { name: /Exceptions? linked to/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /exceptions? · \d+ need/ })).not.toBeInTheDocument()
    const here = dirname(fileURLToPath(import.meta.url))
    expect(existsSync(resolve(here, 'PhaseExceptionGroup.tsx'))).toBe(false)
    expect(existsSync(resolve(here, 'PhaseExceptionGroup.test.tsx'))).toBe(false)
  })

  it('marks the exception the panel is open on as selected', () => {
    renderTimeline(tripWithLoadingExceptions(2).trip, { selectedExceptionId: 'ex-2' })

    const pressed = rowButtons().filter(row => row.getAttribute('aria-current') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0]).toHaveAttribute('id', exceptionRowId('ex-2'))
  })

  it('renders trip-level exceptions in a "Trip record" list with the same row, exactly once each', async () => {
    const onOpenException = vi.fn()
    const base = closedTrip()
    const trip = { ...base, exceptions: [exception('tl', { phase_event_id: null, description: 'No phase' })] }
    renderTimeline(trip, { onOpenException })

    const record = screen.getByRole('region', { name: 'Trip-level events' })
    expect(within(record).getByRole('heading', { name: 'Trip record' })).toBeInTheDocument()
    expect(within(record).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(1)

    await userEvent.click(within(record).getByRole('button', { name: /Route Deviation/ }))
    expect(onOpenException).toHaveBeenCalledWith('tl', null)
  })

  it('de-duplicates conflicting copies of one record before assigning it to a phase or the trip list', () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const tripRecord = exception('dup', { phase_event_id: null })
    const conflicting = { ...tripRecord, phase_event_id: loading.phase_event_id, description: 'Conflicting phase payload' }

    renderTimeline({ ...base, exceptions: [tripRecord, conflicting] })

    expect(screen.getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Trip-level events' })).getAllByRole('button')).toHaveLength(1)
  })
})

describe('TripTimeline: "Show in timeline" reveals the row', () => {
  it('opens a collapsed card, scrolls to the row, focuses it and highlights it', async () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const trip = { ...base, exceptions: [exception('ex-1', { phase_event_id: loading.phase_event_id })] }
    const onRevealHandled = vi.fn()

    renderTimeline(trip, { revealRequest: { exceptionId: 'ex-1', phaseId: loading.phase_event_id, requestId: 1 }, onRevealHandled })

    await waitFor(() => expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'true'))
    const row = await waitFor(() => {
      const found = document.getElementById(exceptionRowId('ex-1'))
      expect(found).toHaveFocus()
      return found!
    })
    expect(row).toHaveAttribute('data-highlighted', 'true')
    expect(onRevealHandled).toHaveBeenCalledWith(exceptionRowId('ex-1'))
    // Rendered once: in the opened rail, not also under the header.
    expect(within(phaseGroup('Loading')).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(1)
  })

  it('keeps the landing highlight visible long enough to find the row, then clears it', () => {
    vi.useFakeTimers()
    try {
      const base = closedTrip()
      const loading = phaseOf(base, 'loading')
      const trip = { ...base, exceptions: [exception('landing', { phase_event_id: loading.phase_event_id })] }
      renderTimeline(trip, { revealRequest: { exceptionId: 'landing', phaseId: loading.phase_event_id, requestId: 1 } })

      act(() => { vi.advanceTimersByTime(100) })
      const row = document.getElementById(exceptionRowId('landing'))!
      expect(row).toHaveAttribute('data-highlighted', 'true')
      act(() => { vi.advanceTimersByTime(1500) })
      expect(row).toHaveAttribute('data-highlighted', 'true')
      act(() => { vi.advanceTimersByTime(1000) })
      expect(row).not.toHaveAttribute('data-highlighted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reveals the 5th of 6 exceptions, which the cap of three hides, then scrolls to and highlights it', async () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    // Priority is unreviewed, then severity, then newest: ex-1..ex-3 are critical and unreviewed,
    // so they fill the cap, and the reviewed info-level ex-5 is the 5th and hidden.
    const exceptions = Array.from({ length: 6 }, (_unused, index) => exception(`ex-${index + 1}`, {
      phase_event_id: loading.phase_event_id, created_at: `2026-05-03T0${index + 1}:00:00Z`,
      severity: index < 3 ? 'critical' : index === 4 ? 'info' : 'warning',
      review_status: index === 4 ? 'reviewed' : 'needs_review',
    }))
    const trip = { ...base, exceptions }
    const onRevealHandled = vi.fn()
    const { rerender } = renderTimeline(trip, { onRevealHandled })
    expect(document.getElementById(exceptionRowId('ex-5'))).toBeNull()
    expect(within(phaseGroup('Loading')).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(3)

    rerender(<TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} onRevealHandled={onRevealHandled}
      revealRequest={{ exceptionId: 'ex-5', phaseId: loading.phase_event_id, requestId: 1 }} />)

    await waitFor(() => expect(document.getElementById(exceptionRowId('ex-5'))).toHaveFocus())
    expect(document.getElementById(exceptionRowId('ex-5'))).toHaveAttribute('data-highlighted', 'true')
    expect(onRevealHandled).toHaveBeenCalledWith(exceptionRowId('ex-5'))
    expect(within(phaseGroup('Loading')).getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(3)
  })

  it('targets the "Trip record" row for a trip-level exception', async () => {
    const trip = { ...closedTrip(), exceptions: [exception('tl', { phase_event_id: null })] }
    const onRevealHandled = vi.fn()

    renderTimeline(trip, { revealRequest: { exceptionId: 'tl', phaseId: null, requestId: 1 }, onRevealHandled })

    await waitFor(() => expect(document.getElementById(exceptionRowId('tl'))).toHaveFocus())
    expect(onRevealHandled).toHaveBeenCalledWith(exceptionRowId('tl'))
    expect(screen.getByRole('region', { name: 'Trip-level events' })).toContainElement(document.getElementById(exceptionRowId('tl')))
  })

  it('can be asked again for the same row after the reader has scrolled away', async () => {
    const base = closedTrip()
    const loading = phaseOf(base, 'loading')
    const trip = { ...base, exceptions: [exception('ex-1', { phase_event_id: loading.phase_event_id })] }
    const onRevealHandled = vi.fn()
    const request = (requestId: number) => ({ exceptionId: 'ex-1', phaseId: loading.phase_event_id, requestId })
    const { rerender } = renderTimeline(trip, { revealRequest: request(1), onRevealHandled })
    await waitFor(() => expect(onRevealHandled).toHaveBeenCalledTimes(1))

    rerender(<TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} onRevealHandled={onRevealHandled} revealRequest={request(2)} />)

    await waitFor(() => expect(onRevealHandled).toHaveBeenCalledTimes(2))
  })
})

describe('TripTimeline: refresh trouble is one status in the toolbar', () => {
  function toolbar(): HTMLElement {
    return document.querySelector<HTMLElement>('[data-timeline-toolbar]')!
  }

  it('says nothing when every resource is fresh', () => {
    renderTimeline(closedTrip())

    expect(within(toolbar()).queryByRole('status')).toBeNull()
  })

  it('names a single stale resource beside the refresh time, with its own Retry', () => {
    const onRetry = vi.fn()
    renderTimeline(closedTrip(), { lastUpdated: Date.now(), warnings: [{ message: 'Evidence could not be refreshed.', onRetry }] })

    const status = within(toolbar()).getByRole('status')
    expect(status).toHaveTextContent('Evidence could not be refreshed.')
    expect(status.previousElementSibling).toHaveTextContent(/^Record refreshed/)
    fireEvent.click(within(status).getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('counts several stale resources in one status, and one Retry tries them all', () => {
    const evidenceRetry = vi.fn()
    const placesRetry = vi.fn()
    renderTimeline(closedTrip(), { warnings: [
      { message: 'Evidence could not be refreshed.', onRetry: evidenceRetry },
      { message: 'Location names could not be refreshed.', onRetry: placesRetry },
    ] })

    const statuses = within(toolbar()).getAllByRole('status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toHaveTextContent('2 sources could not be refreshed')
    // The words for each stay available to a screen reader.
    expect(statuses[0]).toHaveTextContent('Location names could not be refreshed.')
    fireEvent.click(within(statuses[0]!).getByRole('button', { name: 'Retry' }))
    expect(evidenceRetry).toHaveBeenCalledOnce()
    expect(placesRetry).toHaveBeenCalledOnce()
  })
})

describe('TripTimeline: the toolbar keeps its controls together', () => {
  it('places the view switch and the view buttons in fixed areas, and lets only the freshness status move', () => {
    renderTimeline(closedTrip(), { lastUpdated: Date.now(), onToggleExpanded: vi.fn(), warnings: [{ message: 'Evidence could not be refreshed.', onRetry: vi.fn() }] })

    const toolbar = document.querySelector<HTMLElement>('[data-timeline-toolbar]')!
    expect(toolbar.className).toContain("[grid-template-areas:'view_controls'_'status_status']")
    expect(toolbar.className).toContain("lg:[grid-template-areas:'view_status_controls']")
    const controls = toolbar.querySelector('[data-toolbar-controls]')!
    expect(controls.className).toContain('[grid-area:controls]')
    expect(within(controls as HTMLElement).getByRole('button', { name: /expand/i })).toBeInTheDocument()
    const freshness = toolbar.querySelector('[data-toolbar-freshness]')!
    expect(freshness.className).toContain('[grid-area:status]')
    expect(freshness).toContainElement(within(toolbar).getByRole('status'))
  })

  it('reserves no status row when there is nothing to say about freshness', () => {
    renderTimeline(closedTrip(), { onToggleExpanded: vi.fn() })

    const toolbar = document.querySelector<HTMLElement>('[data-timeline-toolbar]')!
    expect(toolbar.querySelector('[data-toolbar-freshness]')).toBeNull()
    expect(toolbar.className).not.toContain('status_status')
  })
})

describe('TripTimeline: help', () => {
  it('puts the timeline help button with the toolbar controls', async () => {
    renderTimeline(closedTrip(), { onToggleExpanded: vi.fn() })

    const controls = document.querySelector<HTMLElement>('[data-toolbar-controls]')!
    await userEvent.click(within(controls).getByRole('button', { name: 'How to read the timeline' }))

    expect(screen.getByRole('region', { name: 'How to read the timeline' })).toHaveTextContent('Each numbered card is one phase')
  })

  it('caps the help panel to the reading area below the toolbar, so the timeline scroller never clips it', async () => {
    renderTimeline(closedTrip(), { onToggleExpanded: vi.fn() })
    const controls = document.querySelector<HTMLElement>('[data-toolbar-controls]')!
    await userEvent.click(within(controls).getByRole('button', { name: 'How to read the timeline' }))

    const anchor = screen.getByRole('region', { name: 'How to read the timeline' }).closest('[data-keep-exception-selection]')!

    expect(anchor.className).toContain('var(--timeline-reader-height')
    expect(anchor.className).toContain('var(--timeline-toolbar-height')
  })

  it('publishes the scroller height for that cap, from the scroller the toolbar sticks in', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420)
    try {
      render(<div data-timeline-scroller><TripTimeline trip={closedTrip()} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} /></div>)

      const section = screen.getByRole('region', { name: 'Trip timeline' })

      expect(section.style.getPropertyValue('--timeline-reader-height')).toBe('420px')
    } finally { height.mockRestore() }
  })
})

it('after_loading_transfer_precedes_departure_and_preserves_expanded_phase_on_refresh', () => {
  const trip = closedTrip()
  const start = new Date('2026-10-20T08:00:00Z').getTime()
  trip.phases = trip.phases.map((phase, index) => ({ ...phase, completed_at: new Date(start + index * 600_000).toISOString() }))
  const loading = phaseOf(trip, 'loading')
  const event = {
    substitution_id: 'completed-transfer', request_id: null, sequence_number: 1,
    outgoing: { id: 'a', full_name: 'Fixture A', phone_number: '+27000000001' },
    incoming: { id: 'b', full_name: 'Fixture B', phone_number: '+27000000002' },
    effective_at: new Date(Date.parse(loading.completed_at!) + 300_000).toISOString(),
    completion_mode: null, anchor_status: null, receipt_id: null, phase_context: null,
    request_format: null, required_confirmation_roles: null, confirmation_policy: null,
  }
  const rendered = renderTimeline(trip)
  openCard('Loading')
  const loadingElement = document.getElementById(`phase-${loading.phase_event_id}`)
  rendered.rerender(<TripTimeline trip={{ ...trip, completed_driver_substitutions: [event, event] }} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence} />)
  const transfer = screen.getByRole('button', { name: /Driver transferred.*Fixture A.*Fixture B/ })
  const departure = document.getElementById(`phase-${phaseOf(trip, 'departure').phase_event_id}`)!
  expect(loadingElement!.compareDocumentPosition(transfer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(transfer.compareDocumentPosition(departure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(document.getElementById(`phase-${loading.phase_event_id}`)).toBe(loadingElement)
  expect(toggleOf('Loading')).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getAllByRole('button', { name: /Driver transferred.*Fixture A.*Fixture B/ })).toHaveLength(1)
})

describe('incidents on the rail', () => {
  const start = new Date('2026-10-20T08:00:00Z').getTime()
  const minutes = (n: number): string => new Date(start + n * 60_000).toISOString()

  function timedTrip(): Trip {
    const trip = closedTrip()
    trip.phases = trip.phases.map((phase, index) => ({ ...phase, completed_at: minutes(index * 10) }))
    return trip
  }

  function incidentAt(id: string, reference: string, when: string): IncidentSummary {
    return { incident_id: id, reference, trip_id: 'trip', trip_reference: 'FP-1', trip_status: 'cancelled', incident_type: 'hijacking',
      summary: 'Truck taken at the toll plaza', status: 'open', confidence: 'reported', outcome: null, assigned_to_user_id: null,
      assigned_to_name: null, reported_occurred_at: when, received_at: when, trip_stopped_at: null, closed_at: null, created_at: when,
      exception_ids: [], exceptions_total: 0, exceptions_reviewed: 0, parcels_total: 0, parcels_unresolved: 0 }
  }

  function transferAt(when: string) {
    return { substitution_id: 'completed-transfer', request_id: null, sequence_number: 1,
      outgoing: { id: 'a', full_name: 'Fixture A', phone_number: '+27000000001' },
      incoming: { id: 'b', full_name: 'Fixture B', phone_number: '+27000000002' }, effective_at: when,
      completion_mode: null, anchor_status: null, receipt_id: null, phase_context: null,
      request_format: null, required_confirmation_roles: null, confirmation_policy: null }
  }

  function renderWith(trip: Trip, incidents: IncidentSummary[], view: TimelineView = 'evidence', onOpenIncident = vi.fn()) {
    return render(<TripTimeline trip={trip} precincts={mockPrecincts} lastUpdated={null} onJump={vi.fn()} {...evidence}
      incidents={incidents} onOpenIncident={onOpenIncident} view={view} />)
  }

  it('places_an_incident_after_the_phase_it_followed_and_before_the_next', () => {
    const trip = timedTrip()
    const loading = phaseOf(trip, 'loading')
    renderWith(trip, [incidentAt('i1', 'INC1', new Date(Date.parse(loading.completed_at!) + 120_000).toISOString())])

    const card = screen.getByRole('button', { name: /Incident INC1/ })
    const departure = document.getElementById(`phase-${phaseOf(trip, 'departure').phase_event_id}`)!
    expect(document.getElementById(`phase-${loading.phase_event_id}`)!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.compareDocumentPosition(departure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sorts_an_incident_against_a_transfer_in_the_same_slot_by_time', () => {
    const trip = timedTrip()
    const loadedAt = Date.parse(phaseOf(trip, 'loading').completed_at!)
    const before = new Date(loadedAt + 60_000).toISOString()
    const after = new Date(loadedAt + 240_000).toISOString()
    const middle = new Date(loadedAt + 120_000).toISOString()
    renderWith({ ...trip, completed_driver_substitutions: [transferAt(middle)] }, [incidentAt('i1', 'INC1', before), incidentAt('i2', 'INC2', after)])

    const order = [/Incident INC1/, /Driver transferred/, /Incident INC2/].map(name => screen.getByRole('button', { name }))
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws_an_incident_on_the_road_inside_the_in_transit_card', () => {
    const trip = timedTrip()
    const departedAt = Date.parse(phaseOf(trip, 'departure').completed_at!)
    renderWith(trip, [incidentAt('i1', 'INC1', new Date(departedAt + 120_000).toISOString())])

    const transit = document.getElementById(`phase-${phaseOf(trip, 'in_transit').phase_event_id}`)!
    expect(within(transit).getByRole('button', { name: /Incident INC1/ })).toBeInTheDocument()
  })

  it('keeps_an_in_transit_incident_visible_when_minimised', () => {
    const trip = timedTrip()
    const departedAt = Date.parse(phaseOf(trip, 'departure').completed_at!)
    renderWith(trip, [incidentAt('i1', 'INC1', new Date(departedAt + 120_000).toISOString())], 'minimised')

    const transit = document.getElementById(`phase-${phaseOf(trip, 'in_transit').phase_event_id}`)!
    expect(within(transit).getByRole('button', { name: /Incident INC1/ })).toBeInTheDocument()
  })

  it('shows_the_incident_in_the_minimised_view_too', () => {
    const trip = timedTrip()
    renderWith(trip, [incidentAt('i1', 'INC1', minutes(25))], 'minimised')

    expect(screen.getByRole('button', { name: /Incident INC1/ })).toBeInTheDocument()
  })

  it('lists_an_incident_in_its_own_block_when_the_phase_times_cannot_place_it', () => {
    const trip = timedTrip()
    trip.phases = trip.phases.map((phase, index) => index === 1 ? { ...phase, completed_at: null } : phase)
    renderWith(trip, [incidentAt('i1', 'INC1', minutes(25))])

    const block = screen.getByRole('region', { name: 'Unplaced incidents' })
    expect(within(block).getByRole('button', { name: /Incident INC1/ })).toBeInTheDocument()
  })

  it('asks_the_page_to_show_the_incident_when_its_card_is_activated', async () => {
    const onOpenIncident = vi.fn()
    renderWith(timedTrip(), [incidentAt('i1', 'INC1', minutes(25))], 'evidence', onOpenIncident)

    await userEvent.click(screen.getByRole('button', { name: /Incident INC1/ }))

    expect(onOpenIncident).toHaveBeenCalledExactlyOnceWith('i1')
  })
})
