import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TripExceptionsPanel } from './TripExceptionsPanel'
import { mockTrips, TRIP_0040_ID } from '@shared/lib/mocks'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException } from '@shared/lib/types/exception'
import { VIEW_ON_MAP_LABEL } from '@/components/domain/LocationEvidencePanel'
import { GPS_MISMATCH_TRIGGER } from '@/components/domain/PositionDisagreement'
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
  it('states the size of each filter, so the unselected one is not a blind click', () => {
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(10, 2)} filter="needs_review" onFilter={vi.fn()} returnTo="/trips/x" />)

    // The panel opens filtered to what needs review, so a dispatcher looking at two rows
    // could not tell whether "All recorded" held another ten or the same two.
    expect(screen.getByRole('button', { name: 'Unreviewed · 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 12' })).toBeInTheDocument()
  })

  it('shows a zero rather than dropping the count when nothing is owed', () => {
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={tripWith(12, 0)} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    // "Twelve recorded, none owed" and "no exceptions at all" are different facts about a
    // trip, and only one of them is good news.
    expect(screen.getByRole('button', { name: 'Unreviewed · 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 12' })).toBeInTheDocument()
  })

  it('counts and renders each exception id once when a polling merge repeats it', () => {
    const base = tripWith(0, 1)
    const repeated = base.exceptions[0]!

    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} trip={{ ...base, exceptions: [repeated, { ...repeated }] }} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByRole('button', { name: 'Unreviewed · 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 1' })).toBeInTheDocument()
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

    expect(screen.getByText('Selected phase · 1 of 2 trip exceptions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unreviewed · 0' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show in timeline' }))
    // The record's own id travels with the phase, so the timeline can reveal that row.
    expect(onShowInTimeline).toHaveBeenCalledWith('linked-loading', phase.phase_event_id)
    fireEvent.click(screen.getByRole('button', { name: 'Clear phase filter' }))
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
  it('keeps two matching phase labels separate and null links visible only when grouping is selected', () => {
    const base=tripWith(0,1)
    const first=base.phases[0]!
    const second={...first,phase_event_id:'second-phase' as typeof first.phase_event_id}
    const rows=[{...base.exceptions[0]!,id:'one' as TripException['id'],phase_event_id:first.phase_event_id},{...base.exceptions[0]!,id:'two' as TripException['id'],phase_event_id:second.phase_event_id},{...base.exceptions[0]!,id:'null' as TripException['id'],phase_event_id:null}]
    render(<TripExceptionsPanel artifactsById={NO_ARTIFACTS} precincts={[]} filter="all" onFilter={vi.fn()} returnTo="/trips/x" trip={{...base,phases:[first,second],exceptions:rows}} />)
    expect(screen.queryByText('Trip-level records')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Group records'),{target:{value:'phase'}})
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
  expect(screen.getByText(`Record ${row.id}`)).toBeInTheDocument()
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
    // Never colour alone: the ring is paired with a word.
    expect(within(selected).getByText(/Selected exception/)).toBeInTheDocument()
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
    expect(screen.getAllByText(/Selected exception/)).toHaveLength(1)
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
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear phase filter' })[0]!)
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
