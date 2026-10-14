import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '@/lib/verify'
import { makeView } from '@/test/factories'
import type { PublicPackSeal } from '@/lib/types'
import { PdfCheck, sealedPdfHash } from './PdfCheck'

async function sealFor(pdf: string): Promise<PublicPackSeal> {
  const payload = JSON.stringify({ pdf_sha256: await sha256Hex(pdf), pack_id: 'pack-1' })
  return {
    ...makeView().seal,
    // The API's own field deliberately disagrees: the check must use the sealed payload.
    pdf_sha256: '00'.repeat(32),
    seal: { canonical_payload: payload, data_hash: await sha256Hex(payload), hedera_topic_id: '0.0.1',
            hedera_sequence_number: 1, hedera_tx_id: 'tx', hedera_consensus_at: null },
  }
}

describe('sealedPdfHash', () => {
  it('reads the fingerprint from the sealed payload, not the API field', async () => {
    const seal = await sealFor('%PDF-issued')
    expect(sealedPdfHash(seal)).toBe(await sha256Hex('%PDF-issued'))
  })

  it('is null for an unsealed pack', () => {
    expect(sealedPdfHash(makeView().seal)).toBeNull()
  })
})

describe('PdfCheck', () => {
  it('confirms an unaltered copy', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), new File(['%PDF-issued'], 'pack.pdf', { type: 'application/pdf' }))

    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent('pack.pdf is an unaltered copy of pack FP-AUDIT-AP1.')
  })

  it('rejects an altered copy', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), new File(['%PDF-edited'], 'pack.pdf', { type: 'application/pdf' }))

    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent('is NOT the issued PDF')
  })
})
