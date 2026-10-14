import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_EXCEPTION_RECORD_SORT, EXCEPTION_RECORD_SORT_KEYS, firstExceptionRecordDir, TripExceptionsPanel, type ExceptionDensity, type ExceptionGrouping } from './TripExceptionsPanel'
import { useTableSort } from '@/lib/hooks/useTableSort'
import { mockTrips, TRIP_0040_ID } from '@shared/lib/mocks'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException } from '@shared/lib/types/exception'
import { VIEW_ON_MAP_LABEL } from '@/components/domain/LocationEvidencePanel'
import { GPS_MISMATCH_TRIGGER } from '@/components/domain/PositionDisagreement'
import { EXCEPTION_SELECTION_OUTLINE, exceptionRowId } from '@/components/domain/ExceptionRow'
import type { ArtifactId, EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// ExceptionSummary reaches the API client, which builds a Supabase client at import time.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// EvidencePhoto's provenance block is forensic-only; this file is about the dispatcher view.
vi.mock('@/lib/context/ForensicModeContext', () => ({
  useForensicMode: () => ({ canViewForensics: false, forensicOn: false, toggle: vi.fn() }),
}))

// Most tests here do not look at supporting evidence; the ones that do pass their own map.
const NO_ARTIFACTS = new Map<string, EvidenceArtifactWithUrl>()

// The card shows who holds a claim relative to the signed-in dispatcher.
const ME = 'user-me'
// BatchReviewForm (opened from the panel) toasts through useToast.
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: ME } }) }))

function tripWith(reviewed: number, needsReview: number): Trip {
  const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)
  if (!trip) throw new Error('TRIP_0040 fixture is missing')
  const template = trip.exceptions[0]
  if (!template) throw new Error('TRIP_0040 exception fixture is missing')

  const make = (index: number, status: TripException['review_status']): TripException => ({
    ...template,
    id: `${template.id}-${status}-${index}` as TripException['id'],
    review_status: status,
  })
  return {
    ...trip,
    exceptions: [
      ...Array.from({ length: reviewed }, (_, i) => make(i, 'reviewed')),
      ...Array.from({ length: needsReview }, (_, i) => make(i, 'needs_review')),
    ],
  }
}

describe('TripExceptionsPanel filters', () => {
  it('opens all trip-level records without including phased exceptions', () => {
    const trip = tripWith(1, 1)
    trip.exceptions = trip.exceptions.map((e, i) => ({ ...e, phase_event_id: i === 0 ? null : trip.phases[0].phase_event_id }))
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={trip} filter="all" selectedPhaseId="trip-level" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByText('Trip-level records')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 trip exceptions')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^All recorded\s*1$/ })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-exception-id]')).toHaveLength(1)
  })
  it('states the size of each filter, so the unselected one is not a blind click', () => {
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(10, 2)} filter="needs_review" onFilter={vi.fn()} returnTo="/trips/x" />)

    // The panel opens filtered to what needs review, so a dispatcher looking at two rows
    // could not tell whether "All recorded" held another ten or the same two.
    expect(screen.getByRole('tab', { name: /^Unreviewed\s*2$/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^All recorded\s*12$/ })).toBeInTheDocument()
  })

  it('marks the active filter as the selected tab and switches on click', () => {
    const onFilter = vi.fn()
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(10, 2)} filter="needs_review" onFilter={onFilter} returnTo="/trips/x" />)

    expect(screen.getByRole('tab', { name: /^Unreviewed/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^All recorded/ })).toHaveAttribute('aria-selected', 'false')
    fireEvent.click(screen.getByRole('tab', { name: /^All recorded/ }))
    expect(onFilter).toHaveBeenCalledWith('all')
  })

  it('shows a zero rather than dropping the count when nothing is owed', () => {
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(12, 0)} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    // "Twelve recorded, none owed" and "no exceptions at all" are different facts about a
    // trip, and only one of them is good news.
    expect(screen.getByRole('tab', { name: /^Unreviewed\s*0$/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^All recorded\s*12$/ })).toBeInTheDocument()
  })

  it('counts and renders each exception id once when a polling merge repeats it', () => {
    const base = tripWith(0, 1)
    const repeated = base.exceptions[0]!

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...base, exceptions: [repeated, { ...repeated }] }} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByRole('tab', { name: /^Unreviewed\s*1$/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^All recorded\s*1$/ })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Checkpoint Timeout' })).toHaveLength(1)
  })

  it('scopes counts to a selected phase, can clear that filter, and sends a linked record back to its timeline phase', () => {
    const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)
    if (!trip) throw new Error('TRIP_0040 fixture is missing')
    const phase = trip.phases.find(candidate => candidate.phase_type === 'loading')
    if (!phase) throw new Error('TRIP_0040 loading phase is missing')
    const linked = { ...trip.exceptions[0]!, id: 'linked-loading' as TripException['id'], phase_event_id: phase.phase_event_id, review_status: 'recorded' as const }
    const tripLevel = { ...linked, id: 'trip-level' as TripException['id'], phase_event_id: null, review_status: 'needs_review' as const }
    const onClearPhaseFilter = vi.fn()
    const onShowInTimeline = vi.fn()

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...trip, exceptions: [linked, tripLevel] }} filter="all" selectedPhaseId={phase.phase_event_id} onFilter={vi.fn()} onClearPhaseFilter={onClearPhaseFilter} onShowInTimeline={onShowInTimeline} returnTo="/trips/x" />)

    // The filter names its phase the way the group headers do, not just "Selected phase".
    expect(screen.getByText(/^Loading · (Origin|Stop|Destination) · /)).toBeInTheDocument()
    expect(screen.getByText('1 of 2 trip exceptions')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^All recorded\s*1$/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Unreviewed\s*0$/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show in timeline' }))
    // The record's own id travels with the phase, so the timeline can reveal that row.
    expect(onShowInTimeline).toHaveBeenCalledWith('linked-loading', phase.phase_event_id)
    fireEvent.click(screen.getByRole('button', { name: /^Show all \d+$/ }))
    expect(onClearPhaseFilter).toHaveBeenCalledOnce()
  })

  it('offers "Show in timeline" for a trip-level record too, which has no phase to name', () => {
    const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)
    if (!trip) throw new Error('TRIP_0040 fixture is missing')
    const tripLevel = { ...trip.exceptions[0]!, id: 'trip-level' as TripException['id'], phase_event_id: null, review_status: 'needs_review' as const }
    const onShowInTimeline = vi.fn()

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...trip, exceptions: [tripLevel] }} filter="all" onFilter={vi.fn()} onShowInTimeline={onShowInTimeline} returnTo="/trips/x" />)

    fireEvent.click(screen.getByRole('button', { name: 'Show in timeline' }))
    expect(onShowInTimeline).toHaveBeenCalledWith('trip-level', null)
  })

  it('shows an invalid phase filter instead of silently displaying another trip record', () => {
    const onClearPhaseFilter = vi.fn()
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(1, 1)} filter="all" invalidPhaseId="foreign-phase" onFilter={vi.fn()} onClearPhaseFilter={onClearPhaseFilter} returnTo="/trips/x" />)

    expect(screen.getByText('This phase filter is not part of this trip.')).toBeInTheDocument()
    expect(screen.queryByText('Cargo Damage')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear phase filter' }))
    expect(onClearPhaseFilter).toHaveBeenCalledOnce()
  })

  it('offers the map for a position finding whose linked phase recorded a fix, and not for other types', () => {
    const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)
    if (!trip) throw new Error('TRIP_0040 fixture is missing')
    const phase = trip.phases.find(candidate => candidate.phase_type === 'loading')
    if (!phase) throw new Error('TRIP_0040 loading phase is missing')
    const fixedPhase = { ...phase, driver_phone_lat: -33.9, driver_phone_lng: 18.4, horse_gps_lat: -33.95, horse_gps_lng: 18.45 }
    const gps = { ...trip.exceptions[0]!, id: 'gps' as TripException['id'], exception_type: 'gps_mismatch' as const, phase_event_id: phase.phase_event_id, review_status: 'recorded' as const }
    const damage = { ...gps, id: 'damage' as TripException['id'], exception_type: 'cargo_damage' as const }

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...trip, phases: trip.phases.map(p => p.phase_event_id === phase.phase_event_id ? fixedPhase : p), exceptions: [gps, damage] }} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getAllByRole('button', { name: VIEW_ON_MAP_LABEL })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL }))
    expect(screen.getByRole('dialog', { name: /Recorded locations: GPS mismatch · Loading/ })).toBeInTheDocument()
  })

  it('offers batch review only for my or unclaimed non-critical unreviewed rows', () => {
    const base = tripWith(0, 1)
    const template = base.exceptions[0]!
    const row = (id: string, over: Partial<TripException>): TripException =>
      ({ ...template, id: id as TripException['id'], review_status: 'needs_review', ...over })
    const exceptions = [
      row('critical', { severity: 'critical' }),
      row('claimed-by-ana', { severity: 'warning', claimed_by_user_id: 'ana', claimed_by_name: 'Ana' }),
      row('unclaimed', { severity: 'warning' }),
      row('mine-info', { severity: 'info', claimed_by_user_id: ME, claimed_by_name: 'Me' }),
    ]

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...base, exceptions }} filter="needs_review" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByRole('button', { name: 'Review 2 warnings' })).toBeInTheDocument()
    expect(screen.getByText(/^Claimed by Ana/)).toBeInTheDocument()
  })

  it('opens the batch form above the list and closes it again', () => {
    const base = tripWith(0, 2)
    // Pinned explicitly: the fixture's own severity is not what this test is about.
    const exceptions = base.exceptions.map(e => ({ ...e, severity: 'warning' as const, claimed_by_user_id: null }))

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...base, exceptions }} filter="needs_review" onFilter={vi.fn()} returnTo="/trips/x" />)

    fireEvent.click(screen.getByRole('button', { name: 'Review 2 warnings' }))
    expect(screen.getByLabelText('Review note (required)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Review note')).not.toBeInTheDocument()
  })

  it('hides batch review when nothing is batchable', () => {
    const base = tripWith(3, 0)
    const critical: TripException = { ...base.exceptions[0]!, id: 'crit' as TripException['id'], review_status: 'needs_review', severity: 'critical' }

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...base, exceptions: [...base.exceptions, critical] }} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.queryByRole('button', { name: /^Review \d+ warning/ })).not.toBeInTheDocument()
  })
})


// The panel is controlled (TripDetailPanel owns the choices), so these need a stateful parent.
function GroupingHarness({ trip, initialDensity = 'detailed', selectedExceptionId = null, artifactsById = NO_ARTIFACTS, onDensity, onShowInTimeline }: { trip: Trip; initialDensity?: ExceptionDensity; selectedExceptionId?: string | null; artifactsById?: Map<string, EvidenceArtifactWithUrl>; onDensity?: (density: ExceptionDensity) => void; onShowInTimeline?: () => void }) {
  const [grouping, setGrouping] = useState<ExceptionGrouping>('none')
  const [density, setDensity] = useState<ExceptionDensity>(initialDensity)
  const { sort, onSort } = useTableSort({ keys: EXCEPTION_RECORD_SORT_KEYS, firstDir: firstExceptionRecordDir, initial: DEFAULT_EXCEPTION_RECORD_SORT })
  return <TripExceptionsPanel artifactsById={artifactsById} precincts={[]} filter="all" onFilter={vi.fn()} returnTo="/trips/x" trip={trip}
    selectedExceptionId={selectedExceptionId} grouping={grouping} onGrouping={setGrouping} density={density} onDensity={next => { setDensity(next); onDensity?.(next) }}
    sort={sort} onSort={onSort} onShowInTimeline={onShowInTimeline} />
}

describe('optional grouping and batch cap', () => {
  it('allows 100 eligible records and requires narrowing for 101', () => {
    const base = tripWith(0,1)
    const rows = Array.from({length:101},(_,i)=>({...base.exceptions[0]!, id:`cap-${i}` as TripException['id'], severity:'warning' as const, claimed_by_user_id:null}))
    const props={precincts:[],filter:'all' as const,onFilter:vi.fn(),returnTo:'/trips/x'}
    const view=render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} {...props} trip={{...base,exceptions:rows.slice(0,100)}} />)
    expect(screen.getByRole('button',{name:'Review 100 warnings'})).toBeEnabled()
    view.rerender(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} {...props} trip={{...base,exceptions:rows}} />)
    expect(screen.queryByRole('button',{name:'Review 101 warnings'})).not.toBeInTheDocument()
    expect(screen.getByText(/Narrow.*100/)).toBeInTheDocument()
  })
  it('names a phase group by its phase and stop, with its record count, and never by event id', () => {
    const base = tripWith(0, 3)
    const first = base.phases[0]!
    const rows = base.exceptions.map((e, i) => ({ ...e, id: `named-${i}` as TripException['id'], phase_event_id: first.phase_event_id }))
    render(<GroupingHarness trip={{ ...base, phases: [first], exceptions: rows }} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Group by phase' }))

    const group = document.querySelector(`[data-phase-group="${first.phase_event_id}"]`) as HTMLElement
    expect(within(group).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Trip Created')
    expect(within(group).getByText('Dispatcher')).toBeInTheDocument()
    expect(group).not.toHaveTextContent(first.phase_event_id)
    expect(within(group).getByLabelText('3 records')).toHaveTextContent('3')
  })

  it('keeps two matching phase labels separate and null links visible only when grouping is selected', () => {
    const base=tripWith(0,1)
    const first=base.phases[0]!
    const second={...first,phase_event_id:'second-phase' as typeof first.phase_event_id}
    const rows=[{...base.exceptions[0]!,id:'one' as TripException['id'],phase_event_id:first.phase_event_id},{...base.exceptions[0]!,id:'two' as TripException['id'],phase_event_id:second.phase_event_id},{...base.exceptions[0]!,id:'null' as TripException['id'],phase_event_id:null}]
    render(<GroupingHarness trip={{...base,phases:[first,second],exceptions:rows}} />)
    expect(screen.queryByText('Trip-level records')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch',{name:'Group by phase'}))
    expect(document.querySelectorAll('[data-phase-group]')).toHaveLength(3)
    expect(screen.getByText('Trip-level records')).toBeInTheDocument()
  })
})

it('keeps the frozen batch and typed note when a live claim removes all current eligibility', () => {
  const base=tripWith(0,1)
  const row={...base.exceptions[0]!,severity:'warning' as const,claimed_by_user_id:null}
  const props={precincts:[],filter:'all' as const,onFilter:vi.fn(),returnTo:'/trips/x'}
  const view=render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} {...props} trip={{...base,exceptions:[row]}} />)
  fireEvent.click(screen.getByRole('button',{name:'Review 1 warning'}))
  fireEvent.change(screen.getByLabelText('Review note (required)'),{target:{value:'Draft for the explicit batch'}})
  view.rerender(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} {...props} trip={{...base,exceptions:[{...row,claimed_by_user_id:'colleague'}]}} />)
  expect(screen.getByLabelText('Review note (required)')).toHaveValue('Draft for the explicit batch')
  // The form's list is the snapshot it was opened on, even though the live row is no longer eligible.
  expect(screen.getByText('Show all 1')).toBeInTheDocument()
})


describe('selecting one exception', () => {
  // jsdom has no layout, so scrollIntoView is absent: stub it and read which element asked.
  const scrollIntoView = vi.fn()
  beforeEach(() => {
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  it('marks the selected record in words and for assistive tech, and scrolls it into view', async () => {
    const base = tripWith(0, 3)
    const target = base.exceptions[1]!

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={base} filter="all" selectedExceptionId={target.id} onFilter={vi.fn()} returnTo="/trips/x" />)

    const selected = document.querySelector<HTMLElement>(`[data-exception-id="${target.id}"]`)!
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(selected.className).not.toMatch(/(^| )ring-/)
    expect(within(selected).getByRole('article')).toHaveClass('bg-sec-c/25', EXCEPTION_SELECTION_OUTLINE)
    expect(within(selected).getByRole('article').className).not.toMatch(/(^| )ring-/)
    expect(within(selected).getByRole('article').className).not.toContain('before:')
    // The caption above each record repeated the card's own phase label and time, so it is gone;
    // selection is the hairline for the eye and aria-current for assistive tech.
    expect(screen.queryByText(/Selected exception/)).toBeNull()
    expect(screen.queryByText(new RegExp(`Trip ${base.trip_reference} · Raised`))).toBeNull()
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce())
    expect(scrollIntoView.mock.contexts[0]).toBe(selected)
  })

  it('does not scroll or mark anything when no exception is selected', () => {
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(0, 2)} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(document.querySelector('[aria-current="true"]')).toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not scroll again when a live update re-renders the same selection', async () => {
    const base = tripWith(0, 2)
    const props = { artifactsById: NO_ARTIFACTS, precincts: [], filter: 'all' as const, selectedExceptionId: base.exceptions[0]!.id, onFilter: vi.fn(), returnTo: '/trips/x' }
    const view = render(<TripExceptionsPanel {...props} trip={base} />)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce())

    // A polling refetch hands the panel a new trip object; a reader who has scrolled on must not be yanked back.
    view.rerender(<TripExceptionsPanel {...props} trip={{ ...base, exceptions: [...base.exceptions] }} />)

    expect(scrollIntoView).toHaveBeenCalledOnce()
  })

  it('opens on a trip-level exception with no phase filter', () => {
    const base = tripWith(0, 1)
    const tripLevel: TripException = { ...base.exceptions[0]!, id: 'trip-level-x' as TripException['id'], phase_event_id: null }

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...base, exceptions: [tripLevel] }} filter="all" selectedExceptionId={tripLevel.id} onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(document.querySelector('[data-exception-id="trip-level-x"]')).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByText(/^Selected phase/)).not.toBeInTheDocument()
  })

  it('shows a recoverable message for an exception id that is not on this trip', () => {
    const onClearExceptionSelection = vi.fn()

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(0, 2)} filter="all" invalidExceptionId="foreign-exception" onFilter={vi.fn()} onClearExceptionSelection={onClearExceptionSelection} returnTo="/trips/x" />)

    expect(screen.getByText('This exception is not part of this trip.')).toBeInTheDocument()
    // A copied link must never look successful: no other record is shown in its place.
    expect(screen.queryByRole('heading', { name: 'Checkpoint Timeout' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all exceptions' }))
    expect(onClearExceptionSelection).toHaveBeenCalledOnce()
  })

  it('shows both messages when the phase and the exception in the URL are both foreign', () => {
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(0, 1)} filter="all" invalidPhaseId="foreign-phase" invalidExceptionId="foreign-exception" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByText('This phase filter is not part of this trip.')).toBeInTheDocument()
    expect(screen.getByText('This exception is not part of this trip.')).toBeInTheDocument()
  })

  it('says so when the selected exception sits outside the phase filter, and offers to clear it', () => {
    const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)!
    const [loading, departure] = [trip.phases.find(p => p.phase_type === 'loading')!, trip.phases.find(p => p.phase_type === 'departure')!]
    const inLoading: TripException = { ...trip.exceptions[0]!, id: 'in-loading' as TripException['id'], phase_event_id: loading.phase_event_id }
    const inDeparture: TripException = { ...inLoading, id: 'in-departure' as TripException['id'], phase_event_id: departure.phase_event_id }
    const onClearPhaseFilter = vi.fn()

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...trip, exceptions: [inLoading, inDeparture] }} filter="all" selectedPhaseId={loading.phase_event_id} selectedExceptionId={inDeparture.id} onFilter={vi.fn()} onClearPhaseFilter={onClearPhaseFilter} returnTo="/trips/x" />)

    expect(screen.getByText('The selected exception is outside this phase filter.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /^Show all \d+$/ })[0]!)
    expect(onClearPhaseFilter).toHaveBeenCalledOnce()
  })
})

describe('supporting evidence in the panel footer', () => {
  function photoArtifact(id: string): EvidenceArtifactWithUrl {
    return {
      id: id as ArtifactId, trip_id: 't', artifact_type: 'photo', s3_key: 'k', s3_bucket: 'b', file_hash: 'a'.repeat(64),
      mime_type: 'image/jpeg', captured_at: '2026-05-09T07:00:00Z', captured_by_driver_id: null, captured_by_user_id: null,
      captured_lat: null, captured_lng: null, created_at: '2026-05-09T07:00:01Z', phase_event_id: null, evidence_role: null,
      signed_url: 'https://storage.test/photo.jpg',
    }
  }
  function loadingPhase(trip: Trip) {
    const phase = trip.phases.find(p => p.phase_type === 'loading')
    if (!phase) throw new Error('TRIP_0040 loading phase is missing')
    return { ...phase, driver_phone_lat: -33.9, driver_phone_lng: 18.4, horse_gps_lat: -33.95, horse_gps_lng: 18.45 }
  }
  function tripWithOne(over: Partial<TripException>) {
    const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)!
    const phase = loadingPhase(trip)
    const exception: TripException = {
      ...trip.exceptions[0]!, id: 'ev-1' as TripException['id'], phase_event_id: phase.phase_event_id,
      review_status: 'recorded', source: 'system', gps_lat: null, gps_lng: null, supporting_artifact_id: null,
      action_location_assessment: null, ...over,
    }
    return { trip: { ...trip, phases: trip.phases.map(p => p.phase_event_id === phase.phase_event_id ? phase : p), exceptions: [exception] }, exception }
  }

  it('offers the phase positions behind a gps_mismatch under "Supporting evidence"', () => {
    const { trip } = tripWithOne({ exception_type: 'gps_mismatch' })

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={trip} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    const disclosure = screen.getByText('Supporting evidence').closest('details')!
    expect(within(disclosure).getByText(GPS_MISMATCH_TRIGGER)).toBeInTheDocument()
  })

  it('shows the supporting photo the driver attached, resolved from the trip artifacts', () => {
    const { trip } = tripWithOne({ exception_type: 'cargo_damage', supporting_artifact_id: 'art-ev' })

    render(<TripExceptionsPanel artifactsById={new Map([['art-ev', photoArtifact('art-ev')]])} precincts={[]} trip={trip} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    const disclosure = screen.getByText('Supporting evidence').closest('details')!
    expect(within(disclosure).getByRole('img', { name: 'Supporting photo' })).toHaveAttribute('src', 'https://storage.test/photo.jpg')
  })

  it('says a recorded photo could not be retrieved rather than hiding it', () => {
    const { trip } = tripWithOne({ exception_type: 'cargo_damage', supporting_artifact_id: 'art-gone' })

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={trip} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(within(screen.getByText('Supporting evidence').closest('details')!).getByText('Recorded, could not be retrieved')).toBeInTheDocument()
  })

  it('adds no disclosure to an exception that carries neither a photo, a fix nor a position finding', () => {
    const { trip } = tripWithOne({ exception_type: 'cargo_damage' })

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={trip} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.queryByText('Supporting evidence')).not.toBeInTheDocument()
  })

  it('shows the disclosure for a trip-level record that carries a photo, though it has no phase to compare', () => {
    const { trip } = tripWithOne({ exception_type: 'gps_mismatch', phase_event_id: null, supporting_artifact_id: 'art-ev' })

    render(<TripExceptionsPanel artifactsById={new Map([['art-ev', photoArtifact('art-ev')]])} precincts={[]} trip={trip} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    const disclosure = screen.getByText('Supporting evidence').closest('details')!
    expect(within(disclosure).getByRole('img', { name: 'Supporting photo' })).toBeInTheDocument()
    expect(within(disclosure).queryByText(GPS_MISMATCH_TRIGGER)).not.toBeInTheDocument()
  })
})

describe('moving focus to the selected record (A1)', () => {
  let row: HTMLButtonElement
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    row = document.createElement('button')
    row.id = exceptionRowId('timeline-row')
    document.body.append(row)
  })
  afterEach(() => { row.remove(); vi.restoreAllMocks() })
  function dock(matches: boolean): void {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ ...window.matchMedia(''), matches })
  }

  it('focuses the record, named by its exception type, when a timeline row selected it in the docked panel', async () => {
    dock(true)
    const trip = tripWith(0, 3)
    const target = trip.exceptions[1]!
    row.focus()

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={trip} filter="all" selectedExceptionId={target.id} onFilter={vi.fn()} returnTo="/trips/x" />)

    const record = document.querySelector<HTMLElement>(`[data-exception-id="${target.id}"]`)!
    await waitFor(() => expect(record).toHaveFocus())
    const title = within(record).getByRole('heading', { level: 3 }).textContent!
    expect(screen.getByRole('group', { name: title })).toBe(record)
  })

  it('leaves focus alone for a deep link, where no timeline row made the selection', async () => {
    dock(true)
    const trip = tripWith(0, 3)
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={trip} filter="all" selectedExceptionId={trip.exceptions[1]!.id} onFilter={vi.fn()} returnTo="/trips/x" />)

    await waitFor(() => expect(scrolled).toHaveBeenCalled())
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves focus to the overlay below the dock width', async () => {
    dock(false)
    const trip = tripWith(0, 3)
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    row.focus()

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={trip} filter="all" selectedExceptionId={trip.exceptions[1]!.id} onFilter={vi.fn()} returnTo="/trips/x" />)

    await waitFor(() => expect(scrolled).toHaveBeenCalled())
    expect(row).toHaveFocus()
  })

  it('exempts the filters and the Group by phase switch from the click-off rule', () => {
    const trip = tripWith(0, 3)

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={trip} filter="all" selectedExceptionId={trip.exceptions[1]!.id} onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByRole('tablist', { name: 'Exception filters' }).parentElement).toHaveAttribute('data-keep-exception-selection')
    expect(screen.getByRole('switch', { name: 'Group by phase' }).closest('[data-keep-exception-selection]')).not.toBeNull()
  })
})

describe('compact density', () => {
  it('shows one line per record, not the full card, and switches back through the tabs', () => {
    const onDensity = vi.fn()
    render(<GroupingHarness trip={tripWith(0, 3)} onDensity={onDensity} />)

    expect(screen.getAllByRole('link', { name: /Review exception/ })).toHaveLength(3)
    fireEvent.click(screen.getByRole('tab', { name: 'Compact' }))

    expect(onDensity).toHaveBeenCalledWith('compact')
    expect(screen.getByRole('tab', { name: 'Compact' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryAllByRole('link', { name: /Review exception/ })).toHaveLength(0)
    expect(document.querySelectorAll('[id^="exception-panel-row-"]')).toHaveLength(3)
  })

  it('never wears the timeline row id, which the timeline scrolls and click-off rules key on', () => {
    render(<GroupingHarness trip={tripWith(0, 2)} initialDensity="compact" />)

    expect(document.querySelectorAll('[id^="exception-row-"]')).toHaveLength(0)
    expect(document.querySelector('[id^="exception-panel-row-"]')).toHaveAttribute('data-keep-exception-selection')
  })

  function openFirstRow(trip: Trip, extra: { onShowInTimeline?: () => void } = {}) {
    render(<GroupingHarness trip={trip} initialDensity="compact" {...extra} />)
    const id = trip.exceptions[0]!.id
    const rowId = `exception-panel-row-${id}`
    fireEvent.click(document.getElementById(rowId)!)
    return { id, rowId, card: () => document.querySelector(`[data-exception-id="${id}"]`) as HTMLElement | null }
  }

  it('opens a row in place and hands focus to its card', async () => {
    const { card, rowId } = openFirstRow(tripWith(0, 2))

    expect(within(card()!).getByRole('link', { name: /Review exception/ })).toBeInTheDocument()
    await waitFor(() => expect(card()).toHaveFocus())
    expect(document.getElementById(rowId)).toBeNull()
    // The card is its own collapse control now, so there is no separate button for it.
    expect(within(card()!).queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument()
  })

  it('collapses when the card body is clicked, and returns focus to its row', async () => {
    const { card, rowId } = openFirstRow(tripWith(0, 2))

    fireEvent.click(within(card()!).getByRole('heading', { name: /Checkpoint Timeout/ }))

    await waitFor(() => expect(document.getElementById(rowId)).toHaveFocus())
    expect(card()).toBeNull()
  })

  it('stays open when the card\'s own controls are used', () => {
    const onShowInTimeline = vi.fn()
    const { card } = openFirstRow(tripWith(0, 2), { onShowInTimeline })

    fireEvent.click(within(card()!).getByRole('button', { name: 'Show in timeline' }))
    fireEvent.click(within(card()!).getByRole('link', { name: /Review exception/ }))

    expect(onShowInTimeline).toHaveBeenCalledOnce()
    expect(card()).not.toBeNull()
  })

  it('stays open when the map dialog it opened is clicked, since that dialog sits inside the card', () => {
    const trip = mockTrips.find(candidate => candidate.id === TRIP_0040_ID)!
    const phase = trip.phases.find(candidate => candidate.phase_type === 'loading')!
    const fixedPhase = { ...phase, driver_phone_lat: -33.9, driver_phone_lng: 18.4, horse_gps_lat: -33.95, horse_gps_lng: 18.45 }
    const gps = { ...trip.exceptions[0]!, id: 'gps' as TripException['id'], exception_type: 'gps_mismatch' as const, phase_event_id: phase.phase_event_id, review_status: 'recorded' as const }
    render(<GroupingHarness initialDensity="compact" trip={{ ...trip, phases: trip.phases.map(p => p.phase_event_id === phase.phase_event_id ? fixedPhase : p), exceptions: [gps] }} />)
    fireEvent.click(document.getElementById('exception-panel-row-gps')!)
    fireEvent.click(screen.getByRole('button', { name: VIEW_ON_MAP_LABEL }))

    fireEvent.click(screen.getByRole('dialog', { name: /Recorded locations/ }))

    expect(document.querySelector('[data-exception-id="gps"]')).not.toBeNull()
  })

  it('stays open while the reader is selecting text', () => {
    const { card } = openFirstRow(tripWith(0, 2))
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false } as Selection)
    try {
      fireEvent.click(within(card()!).getByRole('heading', { name: /Checkpoint Timeout/ }))

      expect(card()).not.toBeNull()
    } finally { getSelection.mockRestore() }
  })

  it('collapses from the keyboard only when the card itself has focus', async () => {
    const { card, rowId } = openFirstRow(tripWith(0, 2))
    await waitFor(() => expect(card()).toHaveFocus())

    fireEvent.keyDown(within(card()!).getByRole('button', { name: 'Show in timeline' }), { key: 'Enter' })
    expect(card()).not.toBeNull()

    fireEvent.keyDown(card()!, { key: 'Enter' })

    await waitFor(() => expect(document.getElementById(rowId)).toHaveFocus())
    expect(card()).toBeNull()
  })

  it('keeps the URL-selected record open: a click on it does not collapse it', () => {
    Element.prototype.scrollIntoView = vi.fn()
    const trip = tripWith(0, 3)
    render(<GroupingHarness trip={trip} initialDensity="compact" selectedExceptionId={trip.exceptions[1]!.id} />)

    const card = document.querySelector(`[data-exception-id="${trip.exceptions[1]!.id}"]`) as HTMLElement
    expect(within(card).getByRole('link', { name: /Review exception/ })).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('heading', { name: /Checkpoint Timeout/ }))
    expect(document.querySelector(`[data-exception-id="${trip.exceptions[1]!.id}"]`)).not.toBeNull()
    expect(document.querySelectorAll('[id^="exception-panel-row-"]')).toHaveLength(2)
  })
})

describe('sorting records', () => {
  const recordOrder = () => [...document.querySelectorAll<HTMLElement>('[data-exception-id]')].map(el => el.dataset.exceptionId)
  function tripAt(times: Record<string, string>): Trip {
    const base = tripWith(0, Object.keys(times).length)
    return { ...base, exceptions: base.exceptions.map((e, i) => ({ ...e, id: Object.keys(times)[i] as TripException['id'], supporting_artifact_id: null, created_at: Object.values(times)[i]! })) }
  }

  it('opens newest first and reverses on one click', () => {
    render(<GroupingHarness trip={tripAt({ a: '2026-10-01T10:00:00Z', b: '2026-10-01T12:00:00Z', c: '2026-10-01T11:00:00Z' })} />)

    expect(recordOrder()).toEqual(['b', 'c', 'a'])
    expect(screen.getByRole('button', { name: 'Newest first, reverse order' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Newest first, reverse order' }))

    expect(recordOrder()).toEqual(['a', 'c', 'b'])
    expect(screen.getByRole('button', { name: 'Oldest first, reverse order' })).toBeInTheDocument()
  })

  it('orders by the event time a photo was captured, not the time the system recorded the row', () => {
    const photo: EvidenceArtifactWithUrl = {
      id: 'art-early' as ArtifactId, trip_id: 't', artifact_type: 'photo', s3_key: 'k', s3_bucket: 'b', file_hash: 'b'.repeat(64),
      mime_type: 'image/jpeg', captured_at: '2026-10-01T08:00:00Z', captured_by_driver_id: null, captured_by_user_id: null,
      captured_lat: null, captured_lng: null, created_at: '2026-10-01T08:00:01Z', phase_event_id: null, evidence_role: null,
      signed_url: 'https://storage.test/p.jpg',
    }
    const trip = tripAt({ plain: '2026-10-01T10:00:00Z', photographed: '2026-10-01T12:00:00Z' })
    trip.exceptions[1] = { ...trip.exceptions[1]!, supporting_artifact_id: 'art-early' as TripException['supporting_artifact_id'] }

    render(<GroupingHarness trip={trip} artifactsById={new Map([['art-early', photo]])} />)
    fireEvent.click(screen.getByRole('button', { name: /reverse order/ }))

    // Recorded later (12:00) but captured first (08:00), so it leads when oldest comes first.
    expect(recordOrder()).toEqual(['photographed', 'plain'])
  })

  it('keeps equal times in a stable order by id when the direction flips', () => {
    render(<GroupingHarness trip={tripAt({ b: '2026-10-01T10:00:00Z', a: '2026-10-01T10:00:00Z' })} />)

    const newest = recordOrder()
    fireEvent.click(screen.getByRole('button', { name: /reverse order/ }))

    expect(recordOrder()).toEqual(newest)
  })

  it('moves the phase groups with the direction', () => {
    const base = tripWith(0, 2)
    const first = base.phases[0]!
    const second = { ...first, phase_event_id: 'later-phase' as typeof first.phase_event_id }
    const rows = [
      { ...base.exceptions[0]!, id: 'early' as TripException['id'], supporting_artifact_id: null, phase_event_id: first.phase_event_id, created_at: '2026-10-01T09:00:00Z' },
      { ...base.exceptions[1]!, id: 'late' as TripException['id'], supporting_artifact_id: null, phase_event_id: second.phase_event_id, created_at: '2026-10-01T15:00:00Z' },
    ]
    render(<GroupingHarness trip={{ ...base, phases: [first, second], exceptions: rows }} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Group by phase' }))
    const groupOrder = () => [...document.querySelectorAll<HTMLElement>('[data-phase-group]')].map(el => el.dataset.phaseGroup)

    expect(groupOrder()).toEqual(['later-phase', first.phase_event_id])
    fireEvent.click(screen.getByRole('button', { name: /reverse order/ }))

    expect(groupOrder()).toEqual([first.phase_event_id, 'later-phase'])
  })
})
