import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ChainReceiptTag } from './ChainReceiptTag'
import type { BlockchainReceipt, BlockchainReceiptType } from '@shared/lib/types/blockchain'

function receiptOf(receiptType: BlockchainReceiptType): BlockchainReceipt {
  return {
    id: crypto.randomUUID(),
    subject_type: 'phase_event',
    subject_id: crypto.randomUUID(),
    receipt_type: receiptType,
    data_hash: 'a'.repeat(64),
    hedera_topic_id: '0.0.1234',
    hedera_sequence_number: 42,
    hedera_consensus_timestamp: null,
    hedera_tx_id: null,
    created_at: new Date().toISOString(),
  }
}

it.each([
  ['activation', 'Activation receipt anchored'],
  ['loading', 'Loading receipt anchored'],
  ['transit_arrival', 'Arrival attestation anchored'],
  ['arrival_inspection', 'Seal inspection anchored'],
  ['unloading', 'Unloading receipt anchored'],
] as const)('labels a %s phase receipt as %s', (receiptType, label) => {
  render(<ChainReceiptTag receipt={receiptOf(receiptType)} />)

  expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
})

it('labels an override receipt as the override record, never as phase evidence', () => {
  render(<ChainReceiptTag receipt={receiptOf('phase_override')} />)

  expect(screen.getByText(/Override record anchored/)).toBeInTheDocument()
  expect(screen.queryByText(/receipt anchored/)).not.toBeInTheDocument()
})
