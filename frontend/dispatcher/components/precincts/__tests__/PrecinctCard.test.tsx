import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PrecinctCard } from '../PrecinctCard'
import type { Precinct, PrecinctId, OrganizationId } from '@shared/lib/types/precinct'

// Branded IDs are string-only at runtime — this cast mirrors the pattern used in
// frontend/shared/lib/mocks/precincts.ts, not a workaround specific to this test.
const precinctId = (v: string): PrecinctId => v as unknown as PrecinctId
const orgId = (v: string): OrganizationId => v as unknown as OrganizationId

function makePrecinct(overrides: Partial<Precinct> = {}): Precinct {
  return {
    id: precinctId('11111111-1111-4111-8111-111111111111'),
    name: 'FedEx JHB — Linbro Park',
    principal_organization_id: orgId('22222222-2222-4222-8222-222222222222'),
    address: '14 Electron Avenue, Linbro Park, Johannesburg, 2065',
    latitude: -29.08520123,
    longitude: 26.15960456,
    geofence_radius_metres: 300,
    is_shared: true,
    created_at: '2024-01-20T08:00:00Z',
    ...overrides,
  }
}

describe('PrecinctCard', () => {
  it('renders the precinct address as its subtitle', () => {
    render(<PrecinctCard precinct={makePrecinct()} isOwned onClick={vi.fn()} />)

    expect(screen.getByText('14 Electron Avenue, Linbro Park, Johannesburg, 2065')).toBeInTheDocument()
  })

  it('falls back to an em dash when the address is null', () => {
    render(<PrecinctCard precinct={makePrecinct({ address: null })} isOwned onClick={vi.fn()} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows a Shared chip when the precinct is not owned', () => {
    render(<PrecinctCard precinct={makePrecinct()} isOwned={false} onClick={vi.fn()} />)

    // Exact match distinguishes the chip label ("Shared") from the Sharing
    // InfoRow's value ("Shared with you"), which also renders in this state.
    expect(screen.getByText('Shared', { exact: true })).toBeInTheDocument()
  })

  it('renders no Shared chip when the precinct is owned', () => {
    render(<PrecinctCard precinct={makePrecinct()} isOwned onClick={vi.fn()} />)

    expect(screen.queryByText('Shared', { exact: true })).not.toBeInTheDocument()
  })

  it('renders coordinates to 5 decimal places', () => {
    render(<PrecinctCard precinct={makePrecinct()} isOwned onClick={vi.fn()} />)

    expect(screen.getByText(/-29\.08520/)).toBeInTheDocument()
    expect(screen.getByText(/26\.15960/)).toBeInTheDocument()
  })

  it('calls onClick exactly once when clicked', () => {
    const onClick = vi.fn()
    render(<PrecinctCard precinct={makePrecinct()} isOwned onClick={onClick} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
