import { describe, expect, it, vi } from 'vitest'
import vectors from '@/test/fixtures/verify-vectors.json'
import {
  checkBytesAgainstHash,
  mirrorMessageUrl,
  sha256Hex,
  verifyAnchoredRecord,
  type AnchorToCheck,
} from './verify'

const MIRROR = 'https://testnet.mirrornode.hedera.com'

function mirrorResponse(hashHex: string, consensus = '1757656800.123456789'): Response {
  return new Response(JSON.stringify({ message: btoa(hashHex), consensus_timestamp: consensus }), { status: 200 })
}

function anchor(overrides: Partial<AnchorToCheck> = {}): AnchorToCheck {
  const [first] = vectors.vectors
  return {
    canonical_payload: first.canonical,
    data_hash: first.data_hash,
    hedera_topic_id: '0.0.2002',
    hedera_sequence_number: 118,
    ...overrides,
  }
}

describe('sha256Hex', () => {
  it.each(vectors.vectors.map((v) => [v.canonical.slice(0, 40), v]))(
    'matches the backend hash for %s…',
    async (_label, vector) => {
      // Act
      const hash = await sha256Hex(vector.canonical)

      // Assert
      expect(hash).toBe(vector.data_hash)
    },
  )

  it('hashes raw bytes the same as the equivalent text', async () => {
    // Arrange
    const bytes = new TextEncoder().encode('seal')

    // Act / Assert
    expect(await sha256Hex(bytes)).toBe(await sha256Hex('seal'))
  })
})

describe('mirrorMessageUrl', () => {
  it('builds the public mirror-node message address', () => {
    expect(mirrorMessageUrl(`${MIRROR}/`, '0.0.2002', 118)).toBe(`${MIRROR}/api/v1/topics/0.0.2002/messages/118`)
  })
})

describe('verifyAnchoredRecord', () => {
  it('is verified when the payload hashes to the anchored message', async () => {
    // Arrange
    const record = anchor()
    const fetchImpl = vi.fn().mockResolvedValue(mirrorResponse(record.data_hash))

    // Act
    const result = await verifyAnchoredRecord(record, MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('verified')
    expect(result.consensusTimestamp).toBe('1757656800.123456789')
    expect(fetchImpl).toHaveBeenCalledWith(`${MIRROR}/api/v1/topics/0.0.2002/messages/118`, expect.anything())
  })

  it('flags a payload that does not hash to its own claimed hash, without asking Hedera', async () => {
    // Arrange
    const record = anchor({ canonical_payload: '{"seal_number":"FORGED"}' })
    const fetchImpl = vi.fn()

    // Act
    const result = await verifyAnchoredRecord(record, MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('hash_mismatch')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('flags a ledger message that differs from the hash', async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(mirrorResponse('00'.repeat(32)))

    // Act
    const result = await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('ledger_mismatch')
  })

  it('reports an unreachable mirror as unavailable, never as a mismatch', async () => {
    // Arrange
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'))

    // Act
    const result = await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('unavailable')
  })

  it('reports a mirror HTTP error as unavailable', async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }))

    // Act
    const result = await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('unavailable')
  })

  it('reports a record without a ledger position as no_receipt', async () => {
    // Arrange
    const fetchImpl = vi.fn()

    // Act
    const result = await verifyAnchoredRecord(anchor({ hedera_sequence_number: null }), MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('no_receipt')
  })
})

describe('checkBytesAgainstHash', () => {
  it('matches identical bytes and rejects altered ones', async () => {
    // Arrange
    const original = new TextEncoder().encode('%PDF-1.7 pack')
    const expected = await sha256Hex(original)
    const altered = new TextEncoder().encode('%PDF-1.7 pack!')

    // Act
    const same = await checkBytesAgainstHash(original, expected)
    const different = await checkBytesAgainstHash(altered, expected)

    // Assert
    expect(same.matches).toBe(true)
    expect(different.matches).toBe(false)
    expect(different.actual).not.toBe(expected)
  })
})
