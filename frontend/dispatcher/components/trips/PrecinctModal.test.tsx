import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PrecinctModal } from './PrecinctModal'
import { mockPrecincts } from '@shared/lib/mocks/precincts'

const precinct = mockPrecincts[0]!

describe('PrecinctModal', () => {
  it('shows the address and geofence, labelled the same way the timeline does', () => {
    render(<PrecinctModal precinct={precinct} open onClose={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByRole('heading', { name: 'FedEx JHB' })).toBeInTheDocument()
    expect(screen.getByText(precinct.address!)).toBeInTheDocument()
    expect(screen.getByText('300 m')).toBeInTheDocument()
  })

  it('sends "View precinct" to the precinct record with the trip carried as returnTo', () => {
    render(<PrecinctModal precinct={precinct} open onClose={vi.fn()} returnTo="/trips/trip-9" />)

    const link = screen.getByRole('link', { name: 'View precinct' })
    expect(link).toHaveAttribute('href', `/precincts/${precinct.id}?returnTo=%2Ftrips%2Ftrip-9`)
  })

  it('closes the preview when "View precinct" is followed, so it is not still open on return', async () => {
    const onClose = vi.fn()
    render(<PrecinctModal precinct={precinct} open onClose={onClose} returnTo="/trips/x" />)

    await userEvent.click(screen.getByRole('link', { name: 'View precinct' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers an explicit Close, matching every other modal in the app', async () => {
    const onClose = vi.fn()
    render(<PrecinctModal precinct={precinct} open onClose={onClose} returnTo="/trips/x" />)

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
