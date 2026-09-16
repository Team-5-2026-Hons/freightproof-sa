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
})
