import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { IncidentParcel } from '@/lib/types/incident'
import { AffectedCargoPanel } from './AffectedCargoPanel'

const PARCEL: IncidentParcel = {
  parcel_id: 'p1', barcode: 'PP-0001', description: null, consignment_id: 'c1', consignment_reference: 'WB-77',
  delivery_stop: 'Durban', scanned_out_at: '2026-10-20T06:00:00Z', scanned_in_at: null, scan_state: 'no_scan_in_recorded',
  latest_finding: null, added_at: '2026-10-20T09:00:00Z',
}

describe('AffectedCargoPanel', () => {
  it('states the missing scan as a scan fact and the finding as not established', () => {
    // Arrange / Act
    render(<AffectedCargoPanel parcels={[PARCEL]} closed={false} onRecordFinding={vi.fn()} />)

    // Assert
    expect(screen.getByText('No scan-in recorded')).toBeInTheDocument()
    expect(screen.getByText('Not established')).toBeInTheDocument()
    expect(screen.queryByText(/stolen/i)).not.toBeInTheDocument()
  })

  it('needs a reason before a finding is saved', async () => {
    // Arrange
    const onRecordFinding = vi.fn().mockResolvedValue(true)
    render(<AffectedCargoPanel parcels={[PARCEL]} closed={false} onRecordFinding={onRecordFinding} />)
    await userEvent.click(screen.getByRole('button', { name: 'Record finding' }))
    expect(screen.getByRole('button', { name: 'Save finding' })).toBeDisabled()

    // Act
    await userEvent.selectOptions(screen.getByLabelText('Finding for PP-0001'), 'confirmed_missing')
    await userEvent.type(screen.getByLabelText('How this was established'), 'Depot and receiver both searched')
    await userEvent.click(screen.getByRole('button', { name: 'Save finding' }))

    // Assert
    expect(onRecordFinding).toHaveBeenCalledWith('p1', 'confirmed_missing', 'Depot and receiver both searched')
  })

  it('offers no finding control on a closed incident', () => {
    // Arrange / Act
    render(<AffectedCargoPanel parcels={[PARCEL]} closed onRecordFinding={vi.fn()} />)

    // Assert
    expect(screen.queryByRole('button', { name: 'Record finding' })).not.toBeInTheDocument()
  })
})
