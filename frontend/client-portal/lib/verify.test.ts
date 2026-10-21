import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import vectors from '@/test/fixtures/verify-vectors.json'
import {
  checkBytesAgainstHash,
  mirrorMessageUrl,
  sha256Hex,
  trustedMirrorBase,
  verifyAnchoredRecord,
  type AnchorToCheck,
} from './verify'

const MIRROR = 'https://testnet.mirrornode.hedera.com'

function mirrorResponse(hashHex: string, consensus = '1757656800.123456789', extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ message: btoa(hashHex), consensus_timestamp: consensus, ...extra }), { status: 200 })
}

// Unavailable is never silent: every such answer is logged. Silenced here, asserted where it matters.
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

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

describe('verifyAnchoredRecord — beyond the happy path', () => {
  it('says not_found when the mirror answers 404, which is different from not answering', async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"_status":{"messages":[{"message":"Not found"}]}}', { status: 404 }))

    // Act
    const result = await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('not_found')
  })

  it.each([[429], [500], [503]])('treats mirror HTTP %i as unavailable, not as a finding about the record', async (status) => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(new Response('busy', { status }))

    // Act
    const result = await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('unavailable')
    expect(warn).toHaveBeenCalled()
  })

  it('reports a non-JSON mirror answer as unavailable', async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }))

    // Act / Assert
    expect((await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)).state).toBe('unavailable')
  })

  it('reports an answer without a message as unavailable', async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"consensus_timestamp":"1.0"}', { status: 200 }))

    // Act / Assert
    expect((await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)).state).toBe('unavailable')
  })

  it('never rejects on malformed base64 — it is unavailable', async () => {
    // Arrange
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"message":"%%% not base64 %%%"}', { status: 200 }))

    // Act
    const result = await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('unavailable')
  })

  it('is unsupported where the browser has no crypto.subtle, and does not ask the mirror', async () => {
    // Arrange: what a plain-HTTP page sees.
    vi.stubGlobal('crypto', {})
    const fetchImpl = vi.fn()

    // Act
    const result = await verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('unsupported')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('flags a record anchored on a topic other than the pinned one, without asking the mirror', async () => {
    // Arrange
    const fetchImpl = vi.fn()

    // Act
    const result = await verifyAnchoredRecord(anchor({ hedera_topic_id: '0.0.9999' }), MIRROR, fetchImpl, '0.0.2002')

    // Assert
    expect(result.state).toBe('topic_mismatch')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts the pinned topic', async () => {
    // Arrange
    const record = anchor()
    const fetchImpl = vi.fn().mockResolvedValue(mirrorResponse(record.data_hash))

    // Act / Assert
    expect((await verifyAnchoredRecord(record, MIRROR, fetchImpl, '0.0.2002')).state).toBe('verified')
  })

  it('treats a mirror answer for another topic as unavailable, not as evidence either way', async () => {
    // Arrange: the hash even matches — but the mirror answered for a different topic.
    const record = anchor()
    const fetchImpl = vi.fn().mockResolvedValue(mirrorResponse(record.data_hash, undefined, { topic_id: '0.0.7777' }))

    // Act
    const result = await verifyAnchoredRecord(record, MIRROR, fetchImpl)

    // Assert
    expect(result.state).toBe('unavailable')
  })

  it('treats a mirror answer for another sequence number as unavailable', async () => {
    // Arrange
    const record = anchor()
    const fetchImpl = vi.fn().mockResolvedValue(mirrorResponse(record.data_hash, undefined, { topic_id: '0.0.2002', sequence_number: 119 }))

    // Act / Assert
    expect((await verifyAnchoredRecord(record, MIRROR, fetchImpl)).state).toBe('unavailable')
  })

  it('verifies when the echoed topic and sequence agree with the request', async () => {
    // Arrange
    const record = anchor()
    const fetchImpl = vi.fn().mockResolvedValue(mirrorResponse(record.data_hash, undefined, { topic_id: '0.0.2002', sequence_number: 118 }))

    // Act / Assert
    expect((await verifyAnchoredRecord(record, MIRROR, fetchImpl)).state).toBe('verified')
  })

  it('does the local hash check but reports unavailable when no mirror is trusted', async () => {
    // Arrange
    const fetchImpl = vi.fn()

    // Act
    const sound = await verifyAnchoredRecord(anchor(), null, fetchImpl)
    const forged = await verifyAnchoredRecord(anchor({ canonical_payload: '{"x":1}' }), null, fetchImpl)

    // Assert
    expect(sound.state).toBe('unavailable')
    expect(forged.state).toBe('hash_mismatch')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads from the trusted host even when the server names an evil one', async () => {
    // Arrange
    const record = anchor()
    const fetchImpl = vi.fn().mockResolvedValue(mirrorResponse(record.data_hash))
    const base = trustedMirrorBase('testnet', 'https://evil.example')

    // Act
    await verifyAnchoredRecord(record, base, fetchImpl)

    // Assert
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${MIRROR}/api/v1/topics/0.0.2002/messages/118`)
  })

  it('still times out the request where AbortSignal.timeout does not exist', async () => {
    // Arrange: older Safari/WebViews. The fallback must abort the request and then clean up.
    vi.useFakeTimers()
    const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true })
    let started!: () => void
    const requestStarted = new Promise<void>((resolve) => { started = resolve })
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      started()
    }))

    try {
      // Act
      const pending = verifyAnchoredRecord(anchor(), MIRROR, fetchImpl)
      await requestStarted
      await vi.advanceTimersByTimeAsync(10_000)

      // Assert
      expect((await pending).state).toBe('unavailable')
    } finally {
      if (original) Object.defineProperty(AbortSignal, 'timeout', original)
    }
  })
})

describe('trustedMirrorBase', () => {
  it('keeps the server suggestion when it is a public mirror for that network', () => {
    expect(trustedMirrorBase('testnet', 'https://testnet.mirrornode.hedera.com/')).toBe(MIRROR)
    expect(trustedMirrorBase('mainnet', 'https://mainnet.mirrornode.hedera.com')).toBe('https://mainnet.mirrornode.hedera.com')
  })

  it('falls back to the network default for any other host', () => {
    expect(trustedMirrorBase('testnet', 'https://evil.example')).toBe(MIRROR)
    expect(trustedMirrorBase('mainnet', 'https://testnet.mirrornode.hedera.com')).toBe('https://mainnet-public.mirrornode.hedera.com')
    expect(trustedMirrorBase('previewnet', 'not a url')).toBe('https://previewnet.mirrornode.hedera.com')
  })

  it('is not fooled by a trusted host used as a sub-domain or userinfo of another', () => {
    expect(trustedMirrorBase('testnet', 'https://testnet.mirrornode.hedera.com.evil.example')).toBe(MIRROR)
    expect(trustedMirrorBase('testnet', 'https://testnet.mirrornode.hedera.com@evil.example')).toBe(MIRROR)
  })

  it('is null for a network the portal does not know, including inherited object keys', () => {
    expect(trustedMirrorBase('devnet', MIRROR)).toBeNull()
    expect(trustedMirrorBase('constructor', MIRROR)).toBeNull()
  })

  it('ignores case and padding in the network name', () => {
    expect(trustedMirrorBase(' TestNet ', 'https://evil.example')).toBe(MIRROR)
  })
})

describe('PINNED_TOPIC_ID', () => {
  async function pinnedWith(value: string | undefined) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('NEXT_PUBLIC_HCS_TOPIC_ID', undefined as unknown as string)
    else vi.stubEnv('NEXT_PUBLIC_HCS_TOPIC_ID', value)
    return (await import('./verify')).PINNED_TOPIC_ID
  }

  it('is read from the environment and trimmed', async () => {
    expect(await pinnedWith(' 0.0.2002 ')).toBe('0.0.2002')
  })

  it.each([[''], ['   '], [undefined]])('is null when the variable is empty or unset (%j)', async (value) => {
    expect(await pinnedWith(value)).toBeNull()
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
