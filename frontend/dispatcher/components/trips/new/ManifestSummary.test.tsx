import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makePreview } from '@/lib/trips/__fixtures__/preview'
import { ManifestSummary } from './ManifestSummary'

describe('ManifestSummary', () => {
  it('shows what the client manifest says', () => {
    render(<ManifestSummary preview={makePreview()} />)

    const region = screen.getByRole('region', { name: 'Manifest The Courier Guy · CPT 81' })
    expect(within(region).getByText('CPT 81')).toBeInTheDocument()
    expect(within(region).getByText('The Courier Guy')).toBeInTheDocument()
    expect(within(region).getByText('PO-CGY-0081')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('CPT → JNB')).toBeInTheDocument()
    expect(screen.getByText('180.5 kg')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'MFTWB8101' })).toBeInTheDocument()
    expect(screen.getByText('Two pallets shrink-wrapped together')).toBeInTheDocument()
    expect(screen.queryByText(/mock/i)).not.toBeInTheDocument()
  })

  it('names the client once, not again as a fact', () => {
    render(<ManifestSummary preview={makePreview()} />)

    expect(screen.getAllByText('The Courier Guy')).toHaveLength(1)
  })

  it('gives each cargo figure its own tile', () => {
    render(<ManifestSummary preview={makePreview()} />)

    // The waybill table has its own "Parcels" column heading; the tiles are <dt>s.
    const tile = (label: string): Element | null =>
      screen.getAllByText(label).find(el => el.tagName === 'DT')?.nextElementSibling ?? null
    expect(tile('Waybills')).toHaveTextContent('2')
    expect(tile('Parcels')).toHaveTextContent('5')
  })

  it('says when the manifest is still open, and leaves out a missing client reference', () => {
    render(<ManifestSummary preview={makePreview({ is_closed: false, client_reference: null })} />)

    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.queryByText(/Ref/)).not.toBeInTheDocument()
  })
})
