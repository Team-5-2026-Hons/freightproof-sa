import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '@/lib/verify'
import { makeView } from '@/test/factories'
import type { AnchoredRecord } from '@/lib/types'
import { VerificationPanel } from './VerificationPanel'

async function record(payload: string, sequence: number): Promise<AnchoredRecord> {
  return {
    receipt_id: `r-${sequence}`, subject_type: 'phase_event', subject_id: `s-${sequence}`, receipt_type: 'pickup',
    canonical_payload: payload, data_hash: await sha256Hex(payload), hedera_topic_id: '0.0.2002',
    hedera_sequence_number: sequence, hedera_tx_id: 'tx', hedera_consensus_at: null, payload_matches_hash: true,
  }
}

function mirrorReturning(hashes: Record<number, string>) {
  return vi.fn(async (url: string) => {
    const sequence = Number(url.split('/').pop())
    return new Response(JSON.stringify({ message: btoa(hashes[sequence]), consensus_timestamp: '1757656800.0' }))
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('VerificationPanel', () => {
  it('reports every record verified when Hedera agrees', async () => {
    // Arrange
    const records = [await record('{"a":1}', 1), await record('{"b":2}', 2)]
    vi.stubGlobal('fetch', mirrorReturning({ 1: records[0].data_hash, 2: records[1].data_hash }))

    // Act
    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)

    // Assert
    expect(await screen.findByRole('heading', { name: '2 of 2 anchored records verified in your browser' })).toBeInTheDocument()
  })

  it('reports a failure when Hedera holds a different hash', async () => {
    // Arrange
    const records = [await record('{"a":1}', 1)]
    vi.stubGlobal('fetch', mirrorReturning({ 1: 'ff'.repeat(32) }))

    // Act
    render(<VerificationPanel token="tok" seal={makeView().seal} records={records} />)

    // Assert
    expect(await screen.findByRole('heading', { name: '1 record failed verification' })).toBeInTheDocument()
    expect(screen.getByText(/Hedera holds a different hash/)).toBeInTheDocument()
  })
})
