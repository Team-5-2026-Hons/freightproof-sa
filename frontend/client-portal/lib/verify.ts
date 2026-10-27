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
  | 'verified'
  | 'hash_mismatch'
  | 'ledger_mismatch'
  | 'topic_mismatch'
  | 'not_found'
  | 'unavailable'
  | 'unsupported'
  | 'no_receipt'

export interface AnchorCheckResult {
  state: AnchorCheckState
  consensusTimestamp?: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type HederaNetwork = 'mainnet' | 'testnet' | 'previewnet'

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
  }
  return trusted[0]
}

const pinnedTopic = process.env.NEXT_PUBLIC_HCS_TOPIC_ID?.trim()
export const PINNED_TOPIC_ID: string | null = pinnedTopic ? pinnedTopic : null

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
