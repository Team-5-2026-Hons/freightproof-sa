import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { buildDriverColumns, daysUntil, ExpiryCell } from './driverColumns'
import type { TableRenderContext } from '@/components/ui/Table'
import type { Driver } from '@shared/lib/types/driver'

const NOW = new Date('2026-10-05T10:00:00Z')
const NOTHING_HIDDEN: TableRenderContext = { hidden: new Set() }

function driver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver-1' as Driver['id'],
    organization_id: 'org',
    full_name: 'Sipho Dlamini',
    id_number: '8001015009087',
    phone_number: '0821234567',
    license_number: 'DRV-001',
    license_expiry: '2027-10-05',
    is_active: true,
    idvs_status: 'verified',
    idvs_last_verified_at: null,
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    ...overrides,
  }
}

function cell(columnId: string, row: Driver, context: TableRenderContext = NOTHING_HIDDEN): ReactNode {
  const column = buildDriverColumns({ now: NOW }).find(c => c.id === columnId)
  if (!column) throw new Error(`no column ${columnId}`)
  return column.render(row, context)
}

// Expiry as an ISO date a whole number of days after NOW, so each case reads as "N days left".
const inDays = (days: number): string => new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10)

describe('driver columns', () => {
  it('links the name to the driver and never shows the full ID number', () => {
    render(<>{cell('name', driver())}{cell('id_number', driver())}</>)

    expect(screen.getByRole('link', { name: 'Sipho Dlamini' })).toHaveAttribute('href', '/fleet/drivers/driver-1')
    expect(screen.getByText('···· 9087')).toBeInTheDocument()
    expect(screen.queryByText(/8001015009087/)).toBeNull()
  })

  it('shows the added date under the name only while the added column is hidden', () => {
    const { unmount } = render(<>{cell('name', driver())}</>)
    expect(screen.queryByText(/^Added /)).toBeNull()
    unmount()

    render(<>{cell('name', driver(), { hidden: new Set(['added']) })}</>)
    expect(screen.getByText('Added 01 Oct 2026')).toBeInTheDocument()
  })

  it('shows the added time in SAST, not the browser timezone', () => {
    render(<>{cell('added', driver())}</>)

    expect(screen.getByText('01 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('10:00 SAST')).toBeInTheDocument()
  })

  it('labels status', () => {
    const { unmount } = render(<>{cell('status', driver({ is_active: true }))}</>)
    expect(screen.getByText('Active')).toBeInTheDocument()
    unmount()

    render(<>{cell('status', driver({ is_active: false }))}</>)
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })
})

describe('licence expiry', () => {
  it('counts whole days, negative once expired, null without a date', () => {
    expect(daysUntil(inDays(10), NOW)).toBe(10)
    expect(daysUntil(inDays(-3), NOW)).toBeLessThan(0)
    expect(daysUntil(null, NOW)).toBeNull()
  })

  it.each([
    ['expired', inDays(-5), 'text-red-500'],
    ['at the 30 day line', inDays(30), 'text-red-500'],
    ['just past 30 days', inDays(31), 'text-amber-500'],
    ['at the 90 day line', inDays(90), 'text-amber-500'],
    ['just past 90 days', inDays(91), 'text-surface-on'],
  ])('colours a licence that is %s', (_label, value, colourClass) => {
    render(<ExpiryCell value={value} now={NOW} />)

    expect(screen.getByText(/\d{2} \w+ \d{4}/)).toHaveClass(colourClass)
  })

  it('shows a dash when there is no expiry', () => {
    render(<ExpiryCell value={null} now={NOW} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
