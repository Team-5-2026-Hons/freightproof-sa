// The pack seal's canonical payload is the string Hedera's hash covers (backend
// orchestration/audit_packs/lifecycle.py seal_payload): ids and fingerprints only. Reading it
// is how the page learns what the ledger-anchored seal actually commits to, instead of trusting
// the API's own copies of the same fields.
import type { PublicPackSeal } from './types'

export interface SealPayload {
  payload_version?: unknown
  pack_id?: unknown
  trip_id?: unknown
  pack_version?: unknown
  manifest_sha256?: unknown
  pdf_sha256?: unknown
  issued_at?: unknown
}

export type SealPayloadRead =
  | { state: 'absent' } //     the pack was issued without a seal receipt
  | { state: 'unreadable' } // a receipt exists but its payload is not a JSON object
  | { state: 'ok'; payload: SealPayload }

export function readSealPayload(seal: PublicPackSeal): SealPayloadRead {
  if (!seal.seal) return { state: 'absent' }
  try {
    const parsed: unknown = JSON.parse(seal.seal.canonical_payload)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { state: 'ok', payload: parsed as SealPayload }
    }
  } catch (error) {
    console.warn('The seal payload is not valid JSON', error)
    return { state: 'unreadable' }
  }
  console.warn('The seal payload is not a JSON object')
  return { state: 'unreadable' }
}

/** A string field of the sealed payload, or null if it is missing or the wrong type. */
export function sealedString(read: SealPayloadRead, field: keyof SealPayload): string | null {
  if (read.state !== 'ok') return null
  const value = read.payload[field]
  return typeof value === 'string' ? value : null
}
