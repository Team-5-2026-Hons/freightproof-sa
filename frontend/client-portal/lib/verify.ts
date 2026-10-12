// In-browser verification: the insurer checks FreightProof's anchors against the public
// Hedera mirror node from their own machine, so the check never has to trust our server.
//
// Deliberately no JSON canonicalisation here. The pack carries, per record, the exact
// string the server hashed; we hash that string and parse the facts we display from the
// same string. Re-implementing Python's json.dumps ordering/escaping in TypeScript would
// be a second definition of the canonical form that could silently drift from the first.

/** The fields of an anchored record the check needs — shared by trip records and pack seals. */
export interface AnchorToCheck {
  canonical_payload: string
  data_hash: string
  hedera_topic_id: string | null
  hedera_sequence_number: number | null
}

export type AnchorCheckState =
  | 'verified' //        payload hashes to data_hash, and Hedera holds that hash
  | 'hash_mismatch' //   the payload in the pack does not hash to its own claimed hash
  | 'ledger_mismatch' // Hedera holds a different hash at that position
  | 'unavailable' //     the mirror node could not be reached — NOT evidence of tampering
  | 'no_receipt' //      the record has no ledger position to check

export interface AnchorCheckResult {
  state: AnchorCheckState
  /** Hedera's own "seconds.nanoseconds" consensus time, when the mirror answered. */
  consensusTimestamp?: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

// Long enough for a slow mirror node, short enough that the page never hangs on one.
const MIRROR_TIMEOUT_MS = 10_000

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

export function mirrorMessageUrl(mirrorBase: string, topicId: string, sequence: number): string {
  return `${mirrorBase.replace(/\/+$/, '')}/api/v1/topics/${topicId}/messages/${sequence}`
}

interface MirrorMessage {
  message?: string
  consensus_timestamp?: string
}

export async function verifyAnchoredRecord(
  record: AnchorToCheck,
  mirrorBase: string,
  fetchImpl: FetchLike = fetch,
): Promise<AnchorCheckResult> {
  // Step 1 needs no network: does the pack's payload even produce the hash it claims?
  if ((await sha256Hex(record.canonical_payload)) !== record.data_hash.toLowerCase()) {
    return { state: 'hash_mismatch' }
  }
  if (!record.hedera_topic_id || record.hedera_sequence_number == null) {
    return { state: 'no_receipt' }
  }

  let body: MirrorMessage
  try {
    const response = await fetchImpl(
      mirrorMessageUrl(mirrorBase, record.hedera_topic_id, record.hedera_sequence_number),
      { signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS), referrerPolicy: 'no-referrer' },
    )
    if (!response.ok) return { state: 'unavailable' }
    body = (await response.json()) as MirrorMessage
  } catch {
    return { state: 'unavailable' }
  }
  if (!body.message) return { state: 'unavailable' }

  // The HCS message is the hex digest itself; the mirror base64-encodes message bytes.
  const anchored = atob(body.message).trim().toLowerCase()
  return {
    state: anchored === record.data_hash.toLowerCase() ? 'verified' : 'ledger_mismatch',
    consensusTimestamp: body.consensus_timestamp,
  }
}

export async function checkBytesAgainstHash(
  data: ArrayBuffer | Uint8Array,
  expectedHex: string,
): Promise<{ matches: boolean; actual: string }> {
  const actual = await sha256Hex(data)
  return { matches: actual === expectedHex.toLowerCase(), actual }
}
