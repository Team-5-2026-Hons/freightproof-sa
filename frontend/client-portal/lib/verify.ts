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
  | 'topic_mismatch' //  anchored on a topic other than the one this deployment pins
  | 'not_found' //       the mirror answered 404: no message at that position — NOT unreachable
  | 'unavailable' //     no usable answer from the mirror node — NOT evidence of tampering
  | 'unsupported' //     this browser cannot hash (no crypto.subtle, e.g. a non-HTTPS page)
  | 'no_receipt' //      the record has no ledger position to check

export interface AnchorCheckResult {
  state: AnchorCheckState
  /** Hedera's own "seconds.nanoseconds" consensus time, when the mirror answered. */
  consensusTimestamp?: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type HederaNetwork = 'mainnet' | 'testnet' | 'previewnet'

// The only places this page will read ledger messages from. The API tells the page which
// mirror to use (`mirror_base_url`), but a page that obeyed any host the server named could
// be pointed at a mirror that agrees with whatever the server wants it to. The first entry
// per network is the default and matches backend/app/blockchain/hedera.py.
export const TRUSTED_MIRRORS: Record<HederaNetwork, readonly string[]> = {
  mainnet: ['https://mainnet-public.mirrornode.hedera.com', 'https://mainnet.mirrornode.hedera.com'],
  testnet: ['https://testnet.mirrornode.hedera.com'],
  previewnet: ['https://previewnet.mirrornode.hedera.com'],
}

function isNetwork(value: string): value is HederaNetwork {
  return Object.prototype.hasOwnProperty.call(TRUSTED_MIRRORS, value)
}

/**
 * The mirror origin to check against: the server's suggestion only if it is one of the
 * public mirrors for that network, otherwise the network's default. null for a network this
 * page does not know — there is then no mirror it is willing to trust.
 */
export function trustedMirrorBase(network: string, suggested: string): string | null {
  const key = network.trim().toLowerCase()
  if (!isNetwork(key)) return null
  const trusted = TRUSTED_MIRRORS[key]
  try {
    const origin = new URL(suggested).origin
    if (trusted.includes(origin)) return origin
  } catch {
    // Not a URL at all: fall through to the default rather than fail the check.
  }
  return trusted[0]
}

// When set at build time, a record anchored on any other topic is flagged: the topic id
// names the one FreightProof writes to, which a page cannot learn from the server it is
// checking. Empty or unset means "no pin" (null), not "pin to the empty string".
const pinnedTopic = process.env.NEXT_PUBLIC_HCS_TOPIC_ID?.trim()
export const PINNED_TOPIC_ID: string | null = pinnedTopic ? pinnedTopic : null

// Long enough for a slow mirror node, short enough that the page never hangs on one.
const MIRROR_TIMEOUT_MS = 10_000
const HTTP_NOT_FOUND = 404

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Web Crypto exists only on secure origins (HTTPS, localhost); elsewhere `crypto.subtle` is undefined. */
export function cryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle)
}

export class CryptoUnavailableError extends Error {
  constructor() {
    super('This browser cannot compute SHA-256 here (Web Crypto needs a secure HTTPS page).')
    this.name = 'CryptoUnavailableError'
  }
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  if (!cryptoAvailable()) throw new CryptoUnavailableError()
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

export function mirrorMessageUrl(mirrorBase: string, topicId: string, sequence: number): string {
  return `${mirrorBase.replace(/\/+$/, '')}/api/v1/topics/${topicId}/messages/${sequence}`
}

// Only the fields we read. The mirror also echoes topic_id and sequence_number, which we
// check against the request so a wrong-position answer is never mistaken for the right one.
interface MirrorMessage {
  message?: unknown
  consensus_timestamp?: string
  topic_id?: unknown
  sequence_number?: unknown
}

/** A deadline for the mirror request. AbortSignal.timeout is missing from older Safari/WebViews. */
function deadline(ms: number): { signal: AbortSignal; clear: () => void } {
  if (typeof AbortSignal.timeout === 'function') return { signal: AbortSignal.timeout(ms), clear: () => undefined }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

function unavailable(reason: string, detail?: unknown): AnchorCheckResult {
  // Unavailable is deliberately not a verdict, but it must not be silent either.
  console.warn(`Hedera check unavailable: ${reason}`, detail ?? '')
  return { state: 'unavailable' }
}

/**
 * Never rejects: every way this can go wrong is a state the page can show.
 *
 * `mirrorBase` comes from `trustedMirrorBase`; null means no mirror this page trusts, so only
 * the local hash step can run and the ledger step is reported as unavailable.
 */
export async function verifyAnchoredRecord(
  record: AnchorToCheck,
  mirrorBase: string | null,
  fetchImpl: FetchLike = fetch,
  pinnedTopicId: string | null = PINNED_TOPIC_ID,
): Promise<AnchorCheckResult> {
  // Step 1 needs no network: does the pack's payload even produce the hash it claims?
  let payloadHash: string
  try {
    payloadHash = await sha256Hex(record.canonical_payload)
  } catch (error) {
    if (error instanceof CryptoUnavailableError) return { state: 'unsupported' }
    return unavailable('could not hash the payload', error)
  }
  if (payloadHash !== record.data_hash.toLowerCase()) return { state: 'hash_mismatch' }
  if (!record.hedera_topic_id || record.hedera_sequence_number == null) return { state: 'no_receipt' }
  if (pinnedTopicId !== null && record.hedera_topic_id !== pinnedTopicId) return { state: 'topic_mismatch' }
  if (mirrorBase === null) return unavailable('no trusted mirror for this network')

  const topicId = record.hedera_topic_id
  const sequence = record.hedera_sequence_number
  const { signal, clear } = deadline(MIRROR_TIMEOUT_MS)
  let body: MirrorMessage
  try {
    const response = await fetchImpl(mirrorMessageUrl(mirrorBase, topicId, sequence), { signal, referrerPolicy: 'no-referrer' })
    // 404 is the mirror answering "nothing at that position" — different from not answering.
    if (response.status === HTTP_NOT_FOUND) return { state: 'not_found' }
    if (!response.ok) return unavailable(`mirror answered HTTP ${response.status}`)
    body = (await response.json()) as MirrorMessage
  } catch (error) {
    return unavailable('mirror request failed', error)
  } finally {
    clear()
  }
  if (typeof body !== 'object' || body === null) return unavailable('mirror answer was not an object')
  if (body.topic_id !== undefined && body.topic_id !== topicId) return unavailable('mirror answered for another topic')
  if (body.sequence_number !== undefined && Number(body.sequence_number) !== sequence) {
    return unavailable('mirror answered for another sequence number')
  }
  if (typeof body.message !== 'string' || body.message === '') return unavailable('mirror answer had no message')

  // The HCS message is the hex digest itself; the mirror base64-encodes message bytes.
  let anchored: string
  try {
    anchored = atob(body.message).trim().toLowerCase()
  } catch (error) {
    return unavailable('mirror message was not valid base64', error)
  }
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
