import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { IncidentParcel } from '@/lib/types/incident'
import { CloseIncidentDialog } from './CloseIncidentDialog'

function parcel(barcode: string): IncidentParcel {
  return {
    parcel_id: barcode, barcode, description: null, consignment_id: 'c1', consignment_reference: 'WB1', delivery_stop: null,
    scanned_out_at: '2026-10-20T08:00:00Z', scanned_in_at: null, scan_state: 'no_scan_in_recorded', latest_finding: null,
    added_at: '2026-10-20T09:00:00Z',
  }
}

function renderDialog({ hasCaseNumber = false, unresolved = [] as IncidentParcel[] } = {}) {
  const onSubmit = vi.fn().mockResolvedValue(true)
  const onRecordCase = vi.fn()
  render(<CloseIncidentDialog open unresolved={unresolved} hasCaseNumber={hasCaseNumber} onClose={vi.fn()} onRecordCase={onRecordCase} onSubmit={onSubmit} />)
  return { onSubmit, onRecordCase }
}

describe('CloseIncidentDialog', () => {
  it('requires a reason before closing', () => {
    // Arrange / Act
    renderDialog()

    // Assert
    expect(screen.getByRole('button', { name: 'Close incident' })).toBeDisabled()
  })

  it('warns, but still allows closing, when theft is reported with no case number', async () => {
    // Arrange
    const { onSubmit, onRecordCase } = renderDialog()
    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'theft_reported')

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Record it first' }))
    await userEvent.type(screen.getByLabelText('What was established'), 'Vehicle not recovered')
    await userEvent.click(screen.getByRole('button', { name: 'Close incident' }))

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('No SAPS case number is recorded')
    expect(onRecordCase).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith('theft_reported', 'Vehicle not recovered')
  })

  it('does not warn once a case number is on record', async () => {
    // Arrange
    renderDialog({ hasCaseNumber: true })

    // Act
    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'theft_reported')

    // Assert
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lists the parcels that will stay unresolved', () => {
    // Arrange / Act
    renderDialog({ unresolved: [parcel('P-1'), parcel('P-2')] })

    // Assert
    expect(screen.getByText(/2 parcels will stay unresolved/)).toBeInTheDocument()
    expect(screen.getByText('P-1, P-2')).toBeInTheDocument()
  })
})
