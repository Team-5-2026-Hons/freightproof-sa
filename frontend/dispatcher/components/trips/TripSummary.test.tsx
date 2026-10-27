import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripSummary } from './TripSummary'
import { tripHeaderFacts } from '@/lib/phase/trip-detail'
import { mockTrips } from '@shared/lib/mocks/trips'
import { mockPrecincts } from '@shared/lib/mocks/precincts'
import { mockDrivers } from '@shared/lib/mocks/drivers'

const trip = mockTrips[0]!
const facts = tripHeaderFacts(trip, null)!

function renderSummary(onPanel = vi.fn()) {
  return render(
    <TripSummary
      facts={facts}
      precincts={mockPrecincts}
      driver={mockDrivers[0]!}
      returnTo="/trips/trip-1"
      onBack={vi.fn()}
      onPanel={onPanel}
    />,
  )
}

describe('TripSummary header', () => {
  it('carries no forensic switch; that control lives in Settings', () => {
    renderSummary()

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})

describe('TripSummary vehicle and driver previews', () => {
  it('offers only Info, Cargo and Exceptions and navigates with supported panel values', async () => {
    const onPanel = vi.fn()
    renderSummary(onPanel)
    const nav = screen.getByRole('navigation', { name: 'Trip sections' })
    expect(within(nav).getAllByRole('button')).toHaveLength(3)
    await userEvent.click(within(nav).getByRole('button', { name: 'Info' }))
    await userEvent.click(within(nav).getByRole('button', { name: 'Cargo' }))
    await userEvent.click(within(nav).getByRole('button', { name: /Exceptions/i }))
    expect(onPanel.mock.calls).toEqual([['information'], ['manifest'], ['exceptions']])
  })
  it('opens a vehicle preview instead of navigating away when the horse is clicked', async () => {
    renderSummary()

    await userEvent.click(screen.getByRole('button', { name: new RegExp(trip.horse!.registration) }))

    expect(screen.getByRole('heading', { name: trip.horse!.registration })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View vehicle' })).toHaveAttribute(
      'href', `/fleet/vehicles/${trip.horse!.id}?returnTo=%2Ftrips%2Ftrip-1`,
    )
  })

  it('opens the matching preview for a trailer, not the horse, when a trailer is clicked', async () => {
    renderSummary()
    const trailer = trip.trailers[0]!

    await userEvent.click(screen.getByRole('button', { name: new RegExp(trailer.registration) }))

    expect(screen.getByRole('link', { name: 'View vehicle' })).toHaveAttribute(
      'href', `/fleet/vehicles/${trailer.id}?returnTo=%2Ftrips%2Ftrip-1`,
    )
  })

  it('opens a driver preview that can hand off to the driver record', async () => {
    renderSummary()

    await userEvent.click(screen.getByRole('button', { name: new RegExp(facts.driverName) }))

    expect(screen.getByRole('link', { name: 'View driver' })).toHaveAttribute(
      'href', `/fleet/drivers/${mockDrivers[0]!.id}?returnTo=%2Ftrips%2Ftrip-1`,
    )
  })
})

describe('TripSummary: the "need review" chip', () => {
  const owed = { ...facts, needsReviewCount: 3 }
  function renderChip(onShowFirstUnreviewed?: () => void) {
    return render(
      <TripSummary facts={owed} precincts={mockPrecincts} driver={null} returnTo="/trips/trip-1" onBack={vi.fn()} onPanel={vi.fn()} onShowFirstUnreviewed={onShowFirstUnreviewed} />,
    )
  }

  it('is a control that lands on the first unreviewed row when the page can reveal one', async () => {
    const onShow = vi.fn()
    renderChip(onShow)

    await userEvent.click(screen.getByRole('button', { name: '3 exceptions need review. Show the first in the timeline' }))

    expect(onShow).toHaveBeenCalledOnce()
  })

  it('stays a plain count while there is nothing to land on', () => {
    renderChip()

    expect(screen.getByText('3 exceptions need review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /need review\. Show the first/ })).toBeNull()
  })
})

describe('TripSummary header help', () => {
  it('offers a help button in the header that explains the header', async () => {
    renderSummary()

    await userEvent.click(screen.getByRole('button', { name: "About this trip's header" }))

    expect(screen.getByRole('region', { name: "About this trip's header" })).toHaveTextContent('What the header shows')
  })
})

it.each([false, true])('transfer_action_reuses_normal_or_compact_header_slot (compact=%s)', async (compact) => {
  const open = vi.fn()
  render(<TripSummary facts={facts} precincts={mockPrecincts} driver={mockDrivers[0]!} returnTo="/trips/example" onBack={vi.fn()} onPanel={vi.fn()} compact={compact}
    transferAction={{ label: 'Transfer driver', onClick: open }} />)
  await userEvent.click(screen.getByRole('button', { name: 'Transfer driver' }))
  expect(open).toHaveBeenCalledOnce()
  expect(screen.getByRole('link', { name: mockDrivers[0]!.phone_number })).toHaveAttribute('href', `tel:${mockDrivers[0]!.phone_number}`)
})

it('transfer_action_sits_in_the_driver_label_row_and_keeps_its_label_when_not_compact', () => {
  render(<TripSummary facts={facts} precincts={mockPrecincts} driver={mockDrivers[0]!} returnTo="/trips/example" onBack={vi.fn()} onPanel={vi.fn()}
    transferAction={{ label: 'Transfer driver', onClick: vi.fn() }} />)

  const action = screen.getByRole('button', { name: 'Transfer driver' })
  const name = screen.getByRole('button', { name: new RegExp(facts.driverName) })

  expect(action.parentElement).toHaveTextContent('Driver')
  expect(action.parentElement).not.toBe(name.parentElement)
  expect(action).toHaveTextContent('Transfer driver')
})

it('lets_the_driver_name_truncate_to_the_cell_width', () => {
  render(<TripSummary facts={facts} precincts={mockPrecincts} driver={mockDrivers[0]!} returnTo="/trips/example" onBack={vi.fn()} onPanel={vi.fn()}
    transferAction={{ label: 'Transfer driver', onClick: vi.fn() }} />)

  const name = screen.getByRole('button', { name: new RegExp(facts.driverName) })

  expect(name).toHaveClass('min-w-0', 'max-w-full', 'truncate')
  expect(name.className).not.toMatch(/\b(w|max-w)-\[|\bmax-w-(xs|sm|md|\d)/)
})
