import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripInformation } from './TripInformation'
import { ToastProvider } from '@/lib/context/ToastContext'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { precinctLabel } from '@/lib/phase/trip-detail'
import type { Trip } from '@shared/lib/types/trip'

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

const trip = mockTrips[0]!
const activeTrip = { ...trip, status: 'active' as const }

function renderInformation(overrides: Partial<{ trip: Trip; onOpenPrecinct: () => void }> = {}) {
  const onOpenPrecinct = overrides.onOpenPrecinct ?? vi.fn()
  render(
    <ToastProvider>
      <TripInformation
        trip={overrides.trip ?? trip}
        precincts={mockPrecincts}
        onOpenPrecinct={onOpenPrecinct}
      />
    </ToastProvider>,
  )
  return { onOpenPrecinct }
}

describe('TripInformation stop previews', () => {
  it('hands the clicked stop\'s precinct to the caller rather than opening its own modal', async () => {
    const { onOpenPrecinct } = renderInformation()
    const stop = trip.stops[0]!
    const precinct = mockPrecincts.find(p => p.id === stop.precinct_id)!
    const label = precinctLabel(precinct)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(label) }))

    expect(onOpenPrecinct).toHaveBeenCalledWith(precinct)
    expect(screen.queryByRole('link', { name: 'View precinct' })).not.toBeInTheDocument()
  })
})

describe('TripInformation route list', () => {
  it('ends the last stop without a divider, so the section divider below is the only rule', () => {
    renderInformation()

    const rows = [...document.querySelectorAll('[data-route-stops] > div')]

    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every(row => row.classList.contains('border-b'))).toBe(true)
    expect(rows.every(row => row.classList.contains('last:border-0'))).toBe(true)
    expect(rows.at(-1)!.nextElementSibling).toBeNull()
  })
})

describe('TripInformation sections', () => {
  it('opens Schedule & seal and folds Route away, each with a summary line', () => {
    renderInformation({ trip: activeTrip })

    const schedule = screen.getByRole('heading', { name: 'Schedule & seal' }).closest('details')!
    const route = screen.getByRole('heading', { name: 'Route' }).closest('details')!

    expect(schedule.open).toBe(true)
    expect(route.open).toBe(false)
    expect(route).toHaveTextContent(/\d+ stops? · .+ → .+/)
  })

  it('holds the last departure seal with the schedule, and has no Custody section of its own', () => {
    renderInformation()

    expect(screen.getByRole('heading', { name: 'Schedule & seal' }).closest('details')).toHaveTextContent('Last departure seal')
    expect(screen.queryByRole('heading', { name: 'Custody' })).not.toBeInTheDocument()
  })

  it('no longer carries the Cancel trip button: the panel owns it under Trip actions', () => {
    renderInformation({ trip: activeTrip })

    expect(screen.queryByRole('button', { name: 'Cancel trip' })).not.toBeInTheDocument()
  })
})
