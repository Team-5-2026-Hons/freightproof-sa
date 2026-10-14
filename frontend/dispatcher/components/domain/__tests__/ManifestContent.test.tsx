import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/hooks/useManifest', () => ({ useManifest: vi.fn() }))

import { ManifestContent } from '../ManifestContent'
import { useManifest, type UseManifestResult } from '@/lib/hooks/useManifest'
import { makeSnapshot } from '@/lib/trips/__fixtures__/snapshot'
import { mockManifest0041 } from '@shared/lib/mocks/manifests'
import type { Manifest } from '@shared/lib/types/manifest'

function loaded(manifest: Manifest, overrides: Partial<UseManifestResult> = {}): UseManifestResult {
  return {
    manifest, isLoading: false, isValidating: false, error: null, errorStatus: null,
    lastUpdated: Date.parse('2026-10-02T10:00:00Z'), refetch: vi.fn(), refetchSilent: vi.fn(),
    ...overrides,
  }
}

// What piece A returns for a cancelled trip whose waybills moved to its replacement.
const MOVED: Manifest = {
  trip_id: 'trip-cancelled',
  total_parcel_count: 0,
  origin_scan_complete: false,
  consignments: [],
  pulled_at: '2026-10-02T09:00:00Z',
  pp_manifest_snapshot: makeSnapshot(),
}

describe('ManifestContent and the H0 snapshot', () => {
  it('shows the snapshot as the only record when the waybills moved', () => {
    vi.mocked(useManifest).mockReturnValue(loaded(MOVED))

    render(<ManifestContent tripId="trip-cancelled" />)

    const record = screen.getByRole('region', { name: 'Manifest at creation' })
    expect(record).toHaveTextContent('moved to the trip that replaced it')
    expect(record).toHaveTextContent('2 waybills · 3 parcels · 180.5 kg')
    expect(screen.getByText('MFTWB8101')).toBeInTheDocument()
    expect(screen.queryByText('No waybills on this trip.')).not.toBeInTheDocument()
  })

  it('keeps refresh controls and refresh-error feedback when only the snapshot exists', async () => {
    const refetch = vi.fn()
    vi.mocked(useManifest).mockReturnValue(loaded(MOVED, { error: 'Network down', refetch }))

    render(<ManifestContent tripId="trip-cancelled" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Manifest refresh failed')
    expect(screen.getByRole('alert')).toHaveTextContent('Network down')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: 'Manifest at creation' })).toBeInTheDocument()
  })

  it('keeps the live list and adds the snapshot, collapsed, while cargo is on the trip', () => {
    vi.mocked(useManifest).mockReturnValue(loaded({ ...mockManifest0041, pp_manifest_snapshot: makeSnapshot() }))

    render(<ManifestContent tripId={mockManifest0041.trip_id} />)

    expect(screen.getByText('CPT 81 · 2 waybills · 3 parcels')).toBeInTheDocument()
    expect(screen.getByText(mockManifest0041.consignments[0].parcel_perfect_reference)).toBeInTheDocument()
  })

  it('keeps the live-list empty-filter message when live rows exist but none match', async () => {
    vi.mocked(useManifest).mockReturnValue(loaded({ ...mockManifest0041, pp_manifest_snapshot: makeSnapshot() }))

    render(<ManifestContent tripId={mockManifest0041.trip_id} />)
    await userEvent.type(screen.getByLabelText('Search waybill or barcode'), 'no-such-barcode-zzz')

    expect(screen.getByText('No parcels match this search and scan filter.')).toBeInTheDocument()
    expect(screen.getByText('CPT 81 · 2 waybills · 3 parcels')).toBeInTheDocument()
  })

  it('changes nothing for a trip without a snapshot', () => {
    vi.mocked(useManifest).mockReturnValue(loaded({ ...MOVED, pp_manifest_snapshot: null }))

    render(<ManifestContent tripId="trip-empty-leg" />)

    expect(screen.getByText('No waybills on this trip.')).toBeInTheDocument()
    expect(screen.queryByText(/Manifest at creation/)).not.toBeInTheDocument()
  })
})

describe('ManifestContent layout', () => {
  it('shows scan progress as tiles and per waybill, without explanatory text', () => {
    vi.mocked(useManifest).mockReturnValue(loaded({ ...mockManifest0041, pp_manifest_snapshot: makeSnapshot() }))

    render(<ManifestContent tripId={mockManifest0041.trip_id} />)

    const tile = (label: string): Element | null =>
      screen.getAllByText(label).find(el => el.tagName === 'DT')?.nextElementSibling ?? null
    expect(tile('Parcels')).toHaveTextContent(String(mockManifest0041.total_parcel_count))
    expect(tile('Scanned out')).toHaveTextContent(`/ ${mockManifest0041.total_parcel_count}`)
    expect(screen.getByText(/\d+ parcels · \d+ out · \d+ in/)).toBeInTheDocument()
    expect(screen.queryByText(/Full trip manifest/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Locked at creation' })).toBeInTheDocument()
  })
})
