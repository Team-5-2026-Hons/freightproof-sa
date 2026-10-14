import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripInformation } from './TripInformation'
import { ToastProvider } from '@/lib/context/ToastContext'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { precinctLabel } from '@/lib/phase/trip-detail'
import type { Trip } from '@shared/lib/types/trip'

// CancelTripDialog now lives outside this component, but the module import chain still
// reaches the API client, which builds a Supabase client at import time — same reason
// TripExceptionsPanel.test.tsx mocks this module.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

const trip = mockTrips[0]!
// mockTrips[0] is a closed trip (TRP-2026-0035), so its own trigger is correctly hidden —
// the positive cancel-trigger test below needs a still-cancellable status.
const activeTrip = { ...trip, status: 'active' as const }

function renderInformation(overrides: Partial<{ trip: Trip; onOpenPrecinct: () => void; onCancelTrip: () => void }> = {}) {
  const onOpenPrecinct = overrides.onOpenPrecinct ?? vi.fn()
  const onCancelTrip = overrides.onCancelTrip ?? vi.fn()
  render(
    <ToastProvider>
      <TripInformation
        trip={overrides.trip ?? trip}
        precincts={mockPrecincts}
        onCancelTrip={onCancelTrip}
        onOpenPrecinct={onOpenPrecinct}
      />
    </ToastProvider>,
  )
  return { onOpenPrecinct, onCancelTrip }
}

describe('TripInformation stop previews', () => {
  it('hands the clicked stop\'s precinct to the caller rather than opening its own modal', async () => {
    // The preview must not be TripInformation's own <dialog> — it can render inside
    // DetailPanel's overlay <dialog> below the dock width, and a modal nested inside
    // another open modal centers on the wrong box. The caller owns where it renders.
    const { onOpenPrecinct } = renderInformation()
    const stop = trip.stops[0]!
    const precinct = mockPrecincts.find(p => p.id === stop.precinct_id)!
    const label = precinctLabel(precinct)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(label) }))

    expect(onOpenPrecinct).toHaveBeenCalledWith(precinct)
    expect(screen.queryByRole('link', { name: 'View precinct' })).not.toBeInTheDocument()
  })
})

describe('TripInformation cancel trigger', () => {
  it('calls onCancelTrip rather than opening its own cancellation dialog', async () => {
    // Same reasoning as the precinct preview above: below the dock width this panel
    // renders inside DetailPanel's own overlay <dialog>, so the caller must own where
    // the cancellation dialog renders instead of TripInformation opening one itself.
    const { onCancelTrip } = renderInformation({ trip: activeTrip })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel trip' }))

    expect(onCancelTrip).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Cancel this trip?' })).not.toBeInTheDocument()
  })

  it.each(['closed', 'cancelled'] as const)('hides the trigger once the trip is %s', (status) => {
    const terminalTrip: Trip = { ...trip, status }
    renderInformation({ trip: terminalTrip })

    expect(screen.queryByRole('button', { name: 'Cancel trip' })).not.toBeInTheDocument()
  })
})
