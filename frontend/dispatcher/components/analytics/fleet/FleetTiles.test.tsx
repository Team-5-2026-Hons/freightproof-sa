import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { FleetTiles as FleetTilesData, UnusedVehicle } from '@shared/lib/types/fleet-analytics'
import { FleetTiles } from './FleetTiles'

const NOW = new Date('2026-09-16T12:00:00Z')
const NO_BANDS = { expired: 0, within_30_days: 0, within_90_days: 0, within_180_days: 0, no_date: 0 }

function vehicle(registration: string, vehicleType: UnusedVehicle['vehicle_type']): UnusedVehicle {
  return { vehicle_id: `id-${registration}` as UnusedVehicle['vehicle_id'], registration, vehicle_type: vehicleType }
}

function makeTiles(overrides: Partial<FleetTilesData> = {}): FleetTilesData {
  return {
    live_trips: 7,
    critical_waiting: { count: 0, oldest_created_at: null },
    licence_expiry: { drivers: { ...NO_BANDS, within_30_days: 2 }, vehicle_discs: { ...NO_BANDS, no_date: 1 } },
    unused_vehicles: { window_days: 30, vehicles: [] },
    all_time_start: '2026-06-20',
    ...overrides,
  }
}

function renderTiles(data: FleetTilesData | null, extra: { isLoading?: boolean; error?: string | null; onRetry?: () => void } = {}) {
  return render(
    <FleetTiles
      data={data} isLoading={extra.isLoading ?? false} error={extra.error ?? null}
      onRetry={extra.onRetry ?? vi.fn()} now={NOW}
    />,
  )
}

function tileLink(label: string): HTMLElement {
  const link = screen.getByText(label).closest('a')
  if (link === null) throw new Error(`no link for tile ${label}`)
  return link
}

describe('FleetTiles', () => {
  it('shows each headline number', () => {
    renderTiles(makeTiles())

    expect(within(tileLink('Live trips')).getByText('7')).toBeInTheDocument()
  })

  it('shows only the four tiles, with no Parcels complete or Receipts owed (D26)', () => {
    renderTiles(makeTiles())

    expect(screen.getAllByText(/^(Live trips|Critical Exceptions Waiting|Licences & discs|Unused vehicles)$/)).toHaveLength(4)
    expect(screen.queryByText('Parcels complete')).toBeNull()
    expect(screen.queryByText('Receipts owed')).toBeNull()
  })

  it('links every tile to where the dispatcher acts on it', () => {
    renderTiles(makeTiles())

    expect(tileLink('Live trips')).toHaveAttribute('href', '/')
    expect(tileLink('Critical Exceptions Waiting')).toHaveAttribute('href', '/exceptions')
    expect(tileLink('Unused vehicles')).toHaveAttribute('href', '/fleet/vehicles')
    expect(screen.getByRole('link', { name: 'Drivers' })).toHaveAttribute('href', '/fleet/drivers')
    expect(screen.getByRole('link', { name: 'Discs' })).toHaveAttribute('href', '/fleet/vehicles')
  })

  it('marks critical problems waiting with an icon and a label, not colour alone', () => {
    renderTiles(makeTiles({ critical_waiting: { count: 4, oldest_created_at: '2026-09-14T10:00:00Z' } }))

    const tile = tileLink('Critical Exceptions Waiting')
    expect(within(tile).getByText('4')).toBeInTheDocument()
    expect(within(tile).getByText('Needs attention')).toBeInTheDocument()
    expect(within(tile).getByText('Oldest waiting 2 d')).toBeInTheDocument()
  })

  it('has no warning when nothing is waiting', () => {
    renderTiles(makeTiles())

    expect(within(tileLink('Critical Exceptions Waiting')).queryByText('Needs attention')).toBeNull()
    expect(screen.getByText('Nothing waiting for review')).toBeInTheDocument()
  })

  it('shows the expiry bands for drivers and discs separately', () => {
    renderTiles(makeTiles())

    const driversRow = screen.getByRole('link', { name: 'Drivers' }).closest('tr')
    if (driversRow === null) throw new Error('no drivers row')
    expect(within(driversRow).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['0', '2', '0', '0', '0'])
  })

  it('lists up to three unused registrations and counts the rest', () => {
    renderTiles(makeTiles({
      unused_vehicles: {
        window_days: 30,
        vehicles: [vehicle('H1', 'horse'), vehicle('H2', 'horse'), vehicle('T1', 'trailer'), vehicle('T2', 'trailer')],
      },
    }))

    const tile = tileLink('Unused vehicles')
    expect(within(tile).getByText('4')).toBeInTheDocument()
    expect(within(tile).getByText('2 trucks · 2 trailers — H1, H2, T1, +1 more')).toBeInTheDocument()
  })

  it('says every vehicle ran when none is unused', () => {
    renderTiles(makeTiles())

    expect(screen.getByText('Every vehicle ran in the last 30 days')).toBeInTheDocument()
  })

  it('shows placeholders while loading', () => {
    renderTiles(null, { isLoading: true })

    expect(screen.getByLabelText('Headline numbers, right now')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Live trips')).toBeNull()
  })

  it('offers a retry when the tiles fail to load', () => {
    const onRetry = vi.fn()
    renderTiles(null, { error: 'Server unavailable', onRetry })

    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
