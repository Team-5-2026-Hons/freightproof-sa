import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex, type AnchorCheckResult } from '@/lib/verify'
import { makeView } from '@/test/factories'
import type { PublicPackSeal } from '@/lib/types'
import { PdfCheck, sealedPdfHash } from './PdfCheck'

const VERIFIED: AnchorCheckResult = { state: 'verified' }
const UNAVAILABLE: AnchorCheckResult = { state: 'unavailable' }

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

const pdfFile = (content: string, name = 'pack.pdf') => new File([content], name, { type: 'application/pdf' })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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
  it('confirms an unaltered copy in green only when the seal itself is verified on Hedera', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={VERIFIED} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), pdfFile('%PDF-issued'))

    // Assert
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('pack.pdf is an unaltered copy of pack FP-AUDIT-AP1 (seal verified on Hedera)')
    expect(status).toHaveClass('text-ok')
  })

  it('does not call a matching copy genuine when the seal is unconfirmed — it says the seal is not confirmed, in the warn tone', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={UNAVAILABLE} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), pdfFile('%PDF-issued'))

    // Assert
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      "pack.pdf matches the PDF fingerprint in the pack's seal payload, but the seal itself is not confirmed (Hedera mirror unreachable — try again)",
    )
    expect(status).toHaveClass('text-warn')
    expect(status).not.toHaveClass('text-ok')
    expect(status).not.toHaveTextContent('unaltered copy')
  })

  it('says the seal is still being checked while its result is pending', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={null} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), pdfFile('%PDF-issued'))

    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent('the seal is still being checked')
  })

  it('rejects an altered copy, whatever the seal state', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={VERIFIED} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), pdfFile('%PDF-edited'))

    // Assert
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('is NOT the issued PDF')
    expect(status).toHaveClass('text-err')
  })

  it('says there is no seal to compare against for an unsealed pack', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={makeView().seal} sealCheck={{ state: 'no_receipt' }} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), pdfFile('%PDF-issued'))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('This pack has no Hedera seal to compare against.')
  })

  it('says the seal payload could not be read, and logs it, rather than claiming there is no seal', async () => {
    // Arrange
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const user = userEvent.setup()
    const seal: PublicPackSeal = {
      ...makeView().seal,
      seal: { canonical_payload: '{not json', data_hash: 'ab'.repeat(32), hedera_topic_id: '0.0.1',
              hedera_sequence_number: 1, hedera_tx_id: 'tx', hedera_consensus_at: null },
    }
    render(<PdfCheck seal={seal} sealCheck={UNAVAILABLE} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), pdfFile('%PDF-issued'))

    // Assert
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('could not be read')
    expect(alert).not.toHaveTextContent('no Hedera seal')
    expect(warn).toHaveBeenCalled()
  })

  it('shows a visible error, and recovers, when the file cannot be read', async () => {
    // Arrange
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={VERIFIED} />)
    const unreadable = pdfFile('%PDF-issued')
    unreadable.arrayBuffer = () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError'))

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), unreadable)

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('This file could not be read')
    expect(warn).toHaveBeenCalled()
    expect(screen.queryByText('Hashing…')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Check a PDF copy/)).toBeEnabled()
  })

  it('explains an unsupported browser instead of failing silently', async () => {
    // Arrange: sealFor needs real crypto, so build it first.
    const seal = await sealFor('%PDF-issued')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('crypto', {})
    const user = userEvent.setup()
    render(<PdfCheck seal={seal} sealCheck={{ state: 'unsupported' }} />)

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), pdfFile('%PDF-issued'))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('needs a secure HTTPS page')
  })

  it('shows "Hashing…" while the file is being read', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={VERIFIED} />)
    let release!: (buffer: ArrayBuffer) => void
    const slow = pdfFile('%PDF-issued')
    slow.arrayBuffer = () => new Promise<ArrayBuffer>((resolve) => { release = resolve })

    // Act
    await user.upload(screen.getByLabelText(/Check a PDF copy/), slow)

    // Assert
    expect(await screen.findByText('Hashing…')).toBeInTheDocument()
    await act(async () => release(await pdfFile('%PDF-issued').arrayBuffer()))
    expect(await screen.findByText(/unaltered copy/)).toBeInTheDocument()
    expect(screen.queryByText('Hashing…')).not.toBeInTheDocument()
  })

  it('clears the input after each file so the same file can be chosen again', async () => {
    // Arrange
    const user = userEvent.setup()
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={VERIFIED} />)
    const input = screen.getByLabelText<HTMLInputElement>(/Check a PDF copy/)
    const file = pdfFile('%PDF-issued')

    // Act
    await user.upload(input, file)
    await screen.findByText(/unaltered copy/)

    // Assert: nothing left selected, so a second choice of the same file still fires onChange.
    expect(input.files).toHaveLength(0)
    await user.upload(input, file)
    expect(await screen.findByText(/unaltered copy/)).toBeInTheDocument()
  })

  it('accepts a dropped PDF and stops the browser opening it in the tab', async () => {
    // Arrange
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={VERIFIED} />)
    const label = screen.getByText('Check a PDF copy').closest('label')!

    // Act
    const dragOverNotCancelled = fireEvent.dragOver(label)
    const dropNotCancelled = fireEvent.drop(label, { dataTransfer: { files: [pdfFile('%PDF-issued', 'dropped.pdf')] } })

    // Assert: fireEvent returns false when preventDefault was called.
    expect(dragOverNotCancelled).toBe(false)
    expect(dropNotCancelled).toBe(false)
    expect(await screen.findByText(/dropped\.pdf is an unaltered copy/)).toBeInTheDocument()
  })

  it('shows a focus ring on the drop target when the hidden file input has keyboard focus', async () => {
    // Arrange / Act
    render(<PdfCheck seal={await sealFor('%PDF-issued')} sealCheck={VERIFIED} />)

    // Assert
    expect(screen.getByText('Check a PDF copy').closest('label')).toHaveClass('focus-within:ring-2', 'focus-within:ring-sec')
  })
})
