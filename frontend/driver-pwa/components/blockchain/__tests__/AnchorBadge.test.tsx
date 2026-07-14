// frontend/driver-pwa/components/blockchain/__tests__/AnchorBadge.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { AnchorBadge } from '../AnchorBadge'

const SAMPLE_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
const SAMPLE_RECEIPT = 'bcr-0035-h2'

describe('AnchorBadge', () => {
  it('renders "Anchored" when both eventHash and receiptId are present', () => {
    render(<AnchorBadge eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    expect(screen.getByText('Anchored')).toBeInTheDocument()
  })

  it('carries the truncated hash (first 8 + … + last 8) in the title for the anchored state', () => {
    render(<AnchorBadge eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} />)

    const badge = screen.getByText('Anchored').closest('span')
    const truncated = `${SAMPLE_HASH.slice(0, 8)}…${SAMPLE_HASH.slice(-8)}`

    expect(badge?.getAttribute('title')).toContain(truncated)
    expect(screen.getByText(`Event hash ${truncated}`, { exact: false })).toBeInTheDocument()
  })

  it('renders "Anchoring…" when eventHash is present but receiptId is not', () => {
    render(<AnchorBadge eventHash={SAMPLE_HASH} receiptId={null} />)

    expect(screen.getByText('Anchoring…')).toBeInTheDocument()
    expect(screen.queryByText('Anchored')).not.toBeInTheDocument()
  })

  it('renders nothing when eventHash is null (feeder handshake, or not yet completed)', () => {
    const { container } = render(<AnchorBadge eventHash={null} receiptId={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when eventHash is null even if receiptId is somehow present', () => {
    const { container } = render(<AnchorBadge eventHash={null} receiptId={SAMPLE_RECEIPT} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('passes through className to the underlying Chip', () => {
    render(<AnchorBadge eventHash={SAMPLE_HASH} receiptId={SAMPLE_RECEIPT} className="mt-2" />)

    expect(screen.getByText('Anchored').closest('span')).toHaveClass('mt-2')
  })
})
