import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DriverModal } from './DriverModal'
import { mockDrivers } from '@shared/lib/mocks/drivers'

const driver = mockDrivers[0]!

describe('DriverModal', () => {
  it('sends "View driver" to the fleet record with the trip carried as returnTo', () => {
    render(<DriverModal driver={driver} open onClose={vi.fn()} returnTo="/trips/trip-9" />)

    const link = screen.getByRole('link', { name: 'View driver' })
    expect(link).toHaveAttribute('href', `/fleet/drivers/${driver.id}?returnTo=%2Ftrips%2Ftrip-9`)
  })

  it('closes the preview when "View driver" is followed, so it is not still open on return', async () => {
    const onClose = vi.fn()
    render(<DriverModal driver={driver} open onClose={onClose} returnTo="/trips/x" />)

    await userEvent.click(screen.getByRole('link', { name: 'View driver' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers an explicit Close, matching every other modal in the app', async () => {
    const onClose = vi.fn()
    render(<DriverModal driver={driver} open onClose={onClose} returnTo="/trips/x" />)

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the licence expiry as the date it is, without inventing a time of day', () => {
    render(<DriverModal driver={{ ...driver, license_expiry: '2027-05-21' }} open onClose={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByText('21 May 2027')).toBeInTheDocument()
    expect(screen.queryByText(/21 May 2027,/)).toBeNull()
  })

  it('says so when no licence expiry is recorded', () => {
    render(<DriverModal driver={{ ...driver, license_expiry: null }} open onClose={vi.fn()} returnTo="/trips/x" />)

    expect(screen.getByText('Not recorded')).toBeInTheDocument()
  })
})
