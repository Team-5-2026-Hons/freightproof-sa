import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TripExceptionsPanel } from './TripExceptionsPanel'
import { mockTrips, TRIP_0040_ID } from '@shared/lib/mocks'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException } from '@shared/lib/types/exception'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// ExceptionSummary reaches the API client, which builds a Supabase client at import time.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

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
    render(<TripExceptionsPanel trip={tripWith(10, 2)} filter="needs_review" onFilter={vi.fn()} returnTo="/trips/x" />)

    // The panel opens filtered to what needs review, so a dispatcher looking at two rows
    // could not tell whether "All recorded" held another ten or the same two.
    expect(screen.getByRole('button', { name: 'Needs review · 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 12' })).toBeInTheDocument()
  })

  it('shows a zero rather than dropping the count when nothing is owed', () => {
    render(<TripExceptionsPanel trip={tripWith(12, 0)} filter="all" onFilter={vi.fn()} returnTo="/trips/x" />)

    // "Twelve recorded, none owed" and "no exceptions at all" are different facts about a
    // trip, and only one of them is good news.
    expect(screen.getByRole('button', { name: 'Needs review · 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 12' })).toBeInTheDocument()
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

    render(<TripExceptionsPanel trip={{ ...trip, exceptions: [linked, tripLevel] }} filter="all" selectedPhaseId={phase.phase_event_id} onFilter={vi.fn()} onClearPhaseFilter={onClearPhaseFilter} onShowInTimeline={onShowInTimeline} returnTo="/trips/x" />)

    expect(screen.getByText('Selected phase · 1 of 2 trip exceptions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All recorded · 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Needs review · 0' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show in timeline' }))
    expect(onShowInTimeline).toHaveBeenCalledWith(phase.phase_event_id)
    fireEvent.click(screen.getByRole('button', { name: 'Clear phase filter' }))
    expect(onClearPhaseFilter).toHaveBeenCalledOnce()
  })

  it('shows an invalid phase filter instead of silently displaying another trip record', () => {
    const onClearPhaseFilter = vi.fn()
    render(<TripExceptionsPanel trip={tripWith(1, 1)} filter="all" invalidPhaseId="foreign-phase" onFilter={vi.fn()} onClearPhaseFilter={onClearPhaseFilter} returnTo="/trips/x" />)

    expect(screen.getByText('This phase filter is not part of this trip.')).toBeInTheDocument()
    expect(screen.queryByText('Cargo Damage')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear phase filter' }))
    expect(onClearPhaseFilter).toHaveBeenCalledOnce()
  })
})
