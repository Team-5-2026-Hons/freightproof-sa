// frontend/driver-pwa/components/blockchain/__tests__/AnchorProgress.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { AnchorProgress } from '../AnchorProgress'

const SAMPLE_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
const SAMPLE_RECEIPT = 'bcr-0035-h2'

describe('AnchorProgress', () => {
  it('renders nothing when eventHash is null (feeder handshake, or not yet completed)', () => {
    const { container } = render(<AnchorProgress eventHash={null} receiptId={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when eventHash is null even if receiptId is somehow present', () => {
    const { container } = render(<AnchorProgress eventHash={null} receiptId={SAMPLE_RECEIPT} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('in-progress state: hash present, no receipt — shows a spinner row and a pending row', () => {
    render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={null} />)

    const truncated = `${SAMPLE_HASH.slice(0, 8)}…${SAMPLE_HASH.slice(-8)}`
    expect(screen.getByText(`Evidence hashed — ${truncated}`, { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Submitted to Hedera HCS')).toBeInTheDocument()
    expect(screen.getByText('Anchor receipt recorded')).toBeInTheDocument()

    // Row 2 is in-progress (spinning) — no completed receipt text yet.
    expect(screen.queryByText(SAMPLE_RECEIPT, { exact: false })).not.toBeInTheDocument()
  })

  it('complete state: hash and receipt both present — all three rows read complete, receipt truncated', () => {
    render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    const truncatedHash = `${SAMPLE_HASH.slice(0, 8)}…${SAMPLE_HASH.slice(-8)}`
    expect(screen.getByText(`Evidence hashed — ${truncatedHash}`, { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Submitted to Hedera HCS')).toBeInTheDocument()
    // SAMPLE_RECEIPT is short enough that truncateHash returns it unchanged.
    expect(screen.getByText(`Anchor receipt recorded — ${SAMPLE_RECEIPT}`, { exact: false })).toBeInTheDocument()
  })

  it('carries the full event hash via title and an sr-only span (never hides evidence)', () => {
    render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    const row = screen.getByText(`Full event hash ${SAMPLE_HASH}`, { exact: false }).closest('li')
    expect(row?.getAttribute('title')).toContain(SAMPLE_HASH)
  })

  it('passes through className to the outer list', () => {
    const { container } = render(<AnchorProgress eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} className="mt-2" />)

    expect(container.firstChild).toHaveClass('mt-2')
  })
})
