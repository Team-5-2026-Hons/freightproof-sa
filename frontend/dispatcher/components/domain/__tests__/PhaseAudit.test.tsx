import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockchainReceipt } from '@shared/lib/types/blockchain'
import { PhaseAudit } from '../PhaseAudit'
import { makePhase } from './testFixtures'

const forensic = vi.hoisted(() => ({ canViewForensics: true, forensicOn: true, toggle: vi.fn() }))
vi.mock('@/lib/context/ForensicModeContext', () => ({ useForensicMode: () => forensic }))
vi.mock('@/components/blockchain/VerifyButton', () => ({
  VerifyButton: ({ subjectId, ariaLabel }: { subjectId: string; ariaLabel?: string }) => (
    <button type="button" aria-label={ariaLabel}>Verify {subjectId}</button>
  ),
}))

const RECEIPT: BlockchainReceipt = {
  id: 'r1', subject_type: 'phase_event', subject_id: 'phase-event-1', receipt_type: 'pickup',
  data_hash: 'a'.repeat(64), hedera_topic_id: '0.0.12345', hedera_sequence_number: 7,
  hedera_consensus_timestamp: '2026-01-01T10:00:00Z', hedera_tx_id: null, created_at: '2026-01-01T10:00:00Z',
}
const EVENT_HASH = 'b'.repeat(64)

beforeEach(() => {
  forensic.canViewForensics = true
  forensic.forensicOn = true
})

describe('PhaseAudit', () => {
  it('shows the receipt tag, the event hash and Verify inside an Audit trail zone', () => {
    const phase = makePhase('departure', { status: 'completed', event_hash: EVENT_HASH, blockchain_receipt_id: 'r1' })

    render(<PhaseAudit phase={phase} receipt={RECEIPT} />)

    const zone = screen.getByRole('region', { name: 'Audit trail' })
    expect(zone).toHaveTextContent('Pickup receipt anchored')
    expect(zone).toHaveTextContent('Hedera seq #7')
    expect(zone).toHaveTextContent(EVENT_HASH)
    expect(screen.getByRole('button', { name: 'Verify integrity for Departure receipt, phase 1' })).toBeInTheDocument()
  })

  it('offers no Verify for a receipt that does not bind a phase event', () => {
    const phase = makePhase('departure', { status: 'completed', event_hash: EVENT_HASH })

    render(<PhaseAudit phase={phase} receipt={{ ...RECEIPT, subject_type: 'trip' }} />)

    expect(screen.queryByRole('button', { name: /Verify/ })).not.toBeInTheDocument()
  })

  it('says nothing is anchored yet when there is neither a receipt nor an event hash', () => {
    render(<PhaseAudit phase={makePhase('departure', { status: 'completed' })} receipt={undefined} />)

    expect(screen.getByText('Nothing anchored yet.')).toBeInTheDocument()
  })

  it.each([
    ['forensic mode is off', true, false],
    ['the dispatcher is not an admin', false, true],
  ] as const)('is not rendered at all when %s', (_case, canViewForensics, forensicOn) => {
    forensic.canViewForensics = canViewForensics
    forensic.forensicOn = forensicOn
    const phase = makePhase('departure', { status: 'completed', event_hash: EVENT_HASH })

    const { container } = render(<PhaseAudit phase={phase} receipt={RECEIPT} />)

    expect(container).toBeEmptyDOMElement()
    expect(document.body.textContent).not.toContain(EVENT_HASH)
  })
})
