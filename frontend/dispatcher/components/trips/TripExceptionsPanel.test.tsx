import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TripExceptionsPanel } from './TripExceptionsPanel'
import { mockTrips, TRIP_0040_ID } from '@shared/lib/mocks'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException } from '@shared/lib/types/exception'
import { VIEW_ON_MAP_LABEL } from '@/components/domain/LocationEvidencePanel'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// ExceptionSummary reaches the API client, which builds a Supabase client at import time.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

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
    render(<TripExceptionsPanel precincts={[]} trip={tripWith(10, 2)} filter="needs_review" onFilter={vi.fn()} returnTo="/trips/x" />)

    // The panel opens filtered to what needs review, so a dispatcher looking at two rows
    // could not tell whether "All recorded" held another ten or the same two.
    expect(screen.getByRole('button', { name: 'Unreviewed · 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 12' })).toBeInTheDocument()
  })

  it('shows a zero rather than dropping the count when nothing is owed', () => {
    render(<TripExceptionsPanel precincts={[]} trip={tripWith(12, 0)} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    // "Twelve recorded, none owed" and "no exceptions at all" are different facts about a
    // trip, and only one of them is good news.
    expect(screen.getByRole('button', { name: 'Unreviewed · 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 12' })).toBeInTheDocument()
  })

  it('counts and renders each exception id once when a polling merge repeats it', () => {
    const base = tripWith(0, 1)
    const repeated = base.exceptions[0]!

    render(<TripExceptionsPanel precincts={[]} trip={{ ...base, exceptions: [repeated, { ...repeated }] }} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

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

    render(<TripExceptionsPanel precincts={[]} trip={{ ...trip, exceptions: [linked, tripLevel] }} filter="all" selectedPhaseId={phase.phase_event_id} onFilter={vi.fn()} onClearPhaseFilter={onClearPhaseFilter} onShowInTimeline={onShowInTimeline} returnTo="/trips/x" />)

    expect(screen.getByText('Selected phase · 1 of 2 trip exceptions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unreviewed · 0' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show in timeline' }))
    expect(onShowInTimeline).toHaveBeenCalledWith(phase.phase_event_id)
    fireEvent.click(screen.getByRole('button', { name: 'Clear phase filter' }))
    expect(onClearPhaseFilter).toHaveBeenCalledOnce()
  })

  it('shows an invalid phase filter instead of silently displaying another trip record', () => {
    const onClearPhaseFilter = vi.fn()
    render(<TripExceptionsPanel precincts={[]} trip={tripWith(1, 1)} filter="all" invalidPhaseId="foreign-phase" onFilter={vi.fn()} onClearPhaseFilter={onClearPhaseFilter} returnTo="/trips/x" />)

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

    render(<TripExceptionsPanel precincts={[]} trip={{ ...trip, phases: trip.phases.map(p => p.phase_event_id === phase.phase_event_id ? fixedPhase : p), exceptions: [gps, damage] }} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

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

    render(<TripExceptionsPanel precincts={[]} trip={{ ...base, exceptions }} filter="needs_review" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByRole('button', { name: 'Review 2 warnings' })).toBeInTheDocument()
    expect(screen.getByText(/^Claimed by Ana/)).toBeInTheDocument()
  })

  it('opens the batch form above the list and closes it again', () => {
    const base = tripWith(0, 2)
    // Pinned explicitly: the fixture's own severity is not what this test is about.
    const exceptions = base.exceptions.map(e => ({ ...e, severity: 'warning' as const, claimed_by_user_id: null }))

    render(<TripExceptionsPanel precincts={[]} trip={{ ...base, exceptions }} filter="needs_review" onFilter={vi.fn()} returnTo="/trips/x" />)

    fireEvent.click(screen.getByRole('button', { name: 'Review 2 warnings' }))
    expect(screen.getByLabelText('Review note (required)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Review note')).not.toBeInTheDocument()
  })

  it('hides batch review when nothing is batchable', () => {
    const base = tripWith(3, 0)
    const critical: TripException = { ...base.exceptions[0]!, id: 'crit' as TripException['id'], review_status: 'needs_review', severity: 'critical' }

    render(<TripExceptionsPanel precincts={[]} trip={{ ...base, exceptions: [...base.exceptions, critical] }} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    expect(screen.queryByRole('button', { name: /^Review \d+ warning/ })).not.toBeInTheDocument()
  })
})


describe('optional grouping and batch cap', () => {
  it('allows 100 eligible records and requires narrowing for 101', () => {
    const base = tripWith(0,1)
    const rows = Array.from({length:101},(_,i)=>({...base.exceptions[0]!, id:`cap-${i}` as TripException['id'], severity:'warning' as const, claimed_by_user_id:null}))
    const props={precincts:[],filter:'all' as const,onFilter:vi.fn(),returnTo:'/trips/x'}
    const view=render(<TripExceptionsPanel {...props} trip={{...base,exceptions:rows.slice(0,100)}} />)
    expect(screen.getByRole('button',{name:'Review 100 warnings'})).toBeEnabled()
    view.rerender(<TripExceptionsPanel {...props} trip={{...base,exceptions:rows}} />)
    expect(screen.queryByRole('button',{name:'Review 101 warnings'})).not.toBeInTheDocument()
    expect(screen.getByText(/Narrow.*100/)).toBeInTheDocument()
  })
  it('keeps two matching phase labels separate and null links visible only when grouping is selected', () => {
    const base=tripWith(0,1)
    const first=base.phases[0]!
    const second={...first,phase_event_id:'second-phase' as typeof first.phase_event_id}
    const rows=[{...base.exceptions[0]!,id:'one' as TripException['id'],phase_event_id:first.phase_event_id},{...base.exceptions[0]!,id:'two' as TripException['id'],phase_event_id:second.phase_event_id},{...base.exceptions[0]!,id:'null' as TripException['id'],phase_event_id:null}]
    render(<TripExceptionsPanel precincts={[]} filter="all" onFilter={vi.fn()} returnTo="/trips/x" trip={{...base,phases:[first,second],exceptions:rows}} />)
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
  const view=render(<TripExceptionsPanel {...props} trip={{...base,exceptions:[row]}} />)
  fireEvent.click(screen.getByRole('button',{name:'Review 1 warning'}))
  fireEvent.change(screen.getByLabelText('Review note (required)'),{target:{value:'Draft for the explicit batch'}})
  view.rerender(<TripExceptionsPanel {...props} trip={{...base,exceptions:[{...row,claimed_by_user_id:'colleague'}]}} />)
  expect(screen.getByLabelText('Review note (required)')).toHaveValue('Draft for the explicit batch')
  expect(screen.getByText(`Record ${row.id}`)).toBeInTheDocument()
})
