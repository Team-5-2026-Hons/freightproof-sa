import { render, screen, within } from '@testing-library/react'
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

function loading(): UseManifestResult {
  return loaded(mockManifest0041, { manifest: null, isLoading: true, isValidating: true, lastUpdated: null })
}

describe('ManifestContent loading', () => {
  it('shows one cargo status with content-shaped, non-interactive placeholders', () => {
    vi.mocked(useManifest).mockReturnValue(loading())

    render(<ManifestContent tripId={mockManifest0041.trip_id} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading cargo…')
    const skeleton = within(status).getByTestId('manifest-content-skeleton')
    expect(skeleton).toHaveAttribute('aria-hidden', 'true')
    expect(skeleton.querySelector('.grid-cols-2')?.children).toHaveLength(4)
    expect(within(skeleton).getAllByTestId('waybill-placeholder')).toHaveLength(3)
    expect(skeleton.querySelectorAll('input, select, button, a, summary, [tabindex]')).toHaveLength(0)
    expect(status.querySelector('.animate-spin')).toBeNull()
  })

  it('replaces the initial skeleton with the real cargo when the manifest arrives', () => {
    vi.mocked(useManifest).mockReturnValue(loading())
    const { rerender } = render(<ManifestContent tripId={mockManifest0041.trip_id} />)
    expect(screen.getByText('Loading cargo…')).toBeInTheDocument()

    vi.mocked(useManifest).mockReturnValue(loaded(mockManifest0041))
    rerender(<ManifestContent tripId={mockManifest0041.trip_id} />)

    expect(screen.queryByTestId('manifest-content-skeleton')).not.toBeInTheDocument()
    expect(screen.getByText('PP-2026-FX-0041')).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('keeps cargo, search, filter and an open waybill during background validation', async () => {
    const user = userEvent.setup()
    vi.mocked(useManifest).mockReturnValue(loaded(mockManifest0041))
    const { rerender } = render(<ManifestContent tripId={mockManifest0041.trip_id} />)
    await user.type(screen.getByRole('searchbox'), 'FX-0041-001')
    await user.selectOptions(screen.getByRole('combobox'), 'not-scanned-in')
    await user.click(screen.getByText('PP-2026-FX-0041'))
    const waybill = screen.getByText('PP-2026-FX-0041').closest('details')
    expect(waybill).toHaveAttribute('open')

    vi.mocked(useManifest).mockReturnValue(loaded(mockManifest0041, { isValidating: true }))
    rerender(<ManifestContent tripId={mockManifest0041.trip_id} />)

    expect(screen.queryByTestId('manifest-content-skeleton')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('FX-0041-001')
    expect(screen.getByRole('combobox')).toHaveValue('not-scanned-in')
    expect(waybill).toHaveAttribute('open')
    expect(screen.getByText('FX-0041-001')).toBeVisible()
    expect(screen.queryByText('FX-0041-002')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
  })

  it('ends initial loading on failure and allows retry', async () => {
    vi.mocked(useManifest).mockReturnValue(loading())
    const { rerender } = render(<ManifestContent tripId={mockManifest0041.trip_id} />)
    const refetch = vi.fn()

    vi.mocked(useManifest).mockReturnValue(loaded(mockManifest0041, {
      manifest: null, error: 'Network down', errorStatus: 503, refetch,
    }))
    rerender(<ManifestContent tripId={mockManifest0041.trip_id} />)

    expect(screen.queryByTestId('manifest-content-skeleton')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load manifest. Network down')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the existing no-manifest message for a 404, without a skeleton or alert', () => {
    vi.mocked(useManifest).mockReturnValue(loaded(mockManifest0041, {
      manifest: null, error: 'Not found', errorStatus: 404,
    }))

    render(<ManifestContent tripId={mockManifest0041.trip_id} />)

    expect(screen.getByRole('status')).toHaveTextContent('No manifest pulled yet.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('manifest-content-skeleton')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

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
