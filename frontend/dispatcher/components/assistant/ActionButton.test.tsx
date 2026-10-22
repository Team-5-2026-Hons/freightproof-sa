import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActionButton } from './ActionButton'
import { PendingNavigation } from './navigation'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

describe('ActionButton', () => {
  it('opens the filled-in trip form and gets the pop-up out of the way', () => {
    const onNavigate = vi.fn()
    render(<ActionButton onNavigate={onNavigate} action={{
      kind: 'open_trip_form', label: 'Open trip form',
      params: {
        mode: 'manifest', manifest_number: 81, driver_id: null, horse_id: null, trailer_ids: [],
        origin_precinct_id: null, destination_precinct_id: null, departure: null, arrival: null,
      },
    }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open trip form' }))

    expect(router.push).toHaveBeenCalledWith('/trips/new?mode=manifest&manifest=81')
    expect(onNavigate).toHaveBeenCalledWith('/trips/new?mode=manifest&manifest=81')
  })

  it('shows it is opening while its page loads, and can\'t be clicked twice', () => {
    render(
      <PendingNavigation.Provider value="/fleet/drivers/d-1">
        <ActionButton onNavigate={vi.fn()} action={{ kind: 'open_page', label: 'Open driver page', page: 'driver', record_id: 'd-1', filters: {} }} />
      </PendingNavigation.Provider>,
    )

    const button = screen.getByRole('button', { name: /Opening…/ })
    expect(button).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})
