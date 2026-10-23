import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BlockchainBadge } from './BlockchainBadge'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'

function receipt(topic: string | null): BlockchainReceipt {
  return {
    id: crypto.randomUUID(),
    subject_type: 'phase_event',
    subject_id: crypto.randomUUID(),
    receipt_type: 'loading',
    data_hash: 'a'.repeat(64),
    hedera_topic_id: topic,
    hedera_sequence_number: 7,
    hedera_consensus_timestamp: null,
    hedera_tx_id: null,
    created_at: new Date().toISOString(),
  }
}

describe('BlockchainBadge', () => {
  it('shows "Verified on blockchain" with a HashScan link for a real topic', () => {
    render(<BlockchainBadge receipt={receipt('0.0.123')} />)

    expect(screen.getByText('Verified on blockchain')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringContaining('/topic/0.0.123'))
  })

  it('rounds its corners with a Tailwind radius step that exists', () => {
    const { container } = render(<BlockchainBadge receipt={receipt('0.0.123')} />)

    expect(container.firstElementChild).toHaveClass('rounded-sm')
  })

  it('never claims verification for the "None" placeholder topic', () => {
    render(<BlockchainBadge receipt={receipt('None')} />)

    expect(screen.queryByText('Verified on blockchain')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows a receipt still waiting for its topic as pending, not as skipped', () => {
    render(<BlockchainBadge receipt={receipt('None')} />)

    expect(screen.getByText('Anchoring…')).toBeInTheDocument()
    expect(screen.queryByText(/skipped anchoring/)).not.toBeInTheDocument()
  })
})
