// frontend/driver-pwa/components/phase/__tests__/WarehouseWaitCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WarehouseWaitCard } from '../WarehouseWaitCard'

const mockRefreshQuietly = vi.fn().mockResolvedValue(undefined)
let mockIsRefreshing = false
let mockLastRefreshedAt: string | null = null

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({
    refreshQuietly: mockRefreshQuietly,
    isRefreshing: mockIsRefreshing,
    lastRefreshedAt: mockLastRefreshedAt,
  }),
}))

beforeEach(() => {
  mockRefreshQuietly.mockClear()
  mockIsRefreshing = false
  mockLastRefreshedAt = null
})

describe('WarehouseWaitCard', () => {
  it('renders the passed body copy verbatim', () => {
    render(<WarehouseWaitCard title="Loading in progress">The warehouse is still scanning the parcels off the truck at this stop.</WarehouseWaitCard>)

    expect(
      screen.getByText('The warehouse is still scanning the parcels off the truck at this stop.'),
    ).toBeInTheDocument()
  })

  it('renders the "Waiting for the warehouse" title regardless of the body copy', () => {
    render(<WarehouseWaitCard title="Loading in progress">The trip will close on its own once they finish.</WarehouseWaitCard>)

    expect(screen.getByText('Waiting for the warehouse')).toBeInTheDocument()
  })

  it('test_titles_the_screen_with_what_the_warehouse_is_doing', () => {
    render(<WarehouseWaitCard title="Unloading in progress">Body copy.</WarehouseWaitCard>)

    expect(screen.getByRole('heading', { level: 1, name: 'Unloading in progress' })).toBeInTheDocument()
  })

  it('renders a Check Now control', () => {
    render(<WarehouseWaitCard title="Loading in progress">Body copy.</WarehouseWaitCard>)

    expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument()
  })

  it('activating Check Now calls refreshQuietly', () => {
    render(<WarehouseWaitCard title="Loading in progress">Body copy.</WarehouseWaitCard>)

    fireEvent.click(screen.getByRole('button', { name: /check now/i }))

    expect(mockRefreshQuietly).toHaveBeenCalledTimes(1)
  })

  it('disables Check Now while a refresh is in flight', () => {
    mockIsRefreshing = true
    render(<WarehouseWaitCard title="Loading in progress">Body copy.</WarehouseWaitCard>)

    expect(screen.getByRole('button', { name: /check now/i })).toBeDisabled()
  })

  it('shows a "Checking…" indicator while a refresh is in flight', () => {
    mockIsRefreshing = true
    render(<WarehouseWaitCard title="Loading in progress">Body copy.</WarehouseWaitCard>)

    expect(screen.getByText('Checking…')).toBeInTheDocument()
  })

  it('shows a last-checked hint once a refresh has landed, instead of "Checking…"', () => {
    mockLastRefreshedAt = '2026-08-10T12:00:00Z'
    render(<WarehouseWaitCard title="Loading in progress">Body copy.</WarehouseWaitCard>)

    expect(screen.queryByText('Checking…')).not.toBeInTheDocument()
    expect(screen.getByText(/last checked/i)).toBeInTheDocument()
  })
})
