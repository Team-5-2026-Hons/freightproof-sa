// What a failed manifest lookup or trip creation means for the screen (FP-281 §10.7).
// The backend's detail text is written for dispatchers, so most failures show it as is.
// Only the cases the screen must act on get their own kind: a changed manifest, a
// manifest already on a trip, and no response at all.

import { ApiError } from '@/lib/api/client'
import { isRecord } from '@/lib/api/json'
import type { PPManifestPreview } from '@shared/lib/types/pp-manifest'

// ApiError status 0: the client gave up and no HTTP response arrived (client.ts).
const NO_RESPONSE = 0
const HTTP_NOT_FOUND = 404
const HTTP_CONFLICT = 409
const HTTP_NOT_IMPLEMENTED = 501
const HTTP_BAD_GATEWAY = 502
const HTTP_GATEWAY_TIMEOUT = 504

const CODE_MANIFEST_CHANGED = 'MANIFEST_CHANGED'
const CODE_MANIFEST_ALREADY_ON_TRIP = 'MANIFEST_ALREADY_ON_TRIP'

const UNEXPECTED = 'Something went wrong. Please try again.'
const LOOKUP_NO_RESPONSE = 'The manifest system did not answer in time. Try again.'

export type LookupFailure =
  | { kind: 'not_found'; message: string }
  | { kind: 'unsupported'; message: string }   // live PP has no manifest lookup (501)
  | { kind: 'retryable'; message: string }     // PP unreachable, or no response
  | { kind: 'rejected'; message: string }

export function classifyLookupError(err: unknown, manifestNumber: number): LookupFailure {
  if (!(err instanceof ApiError)) return { kind: 'rejected', message: UNEXPECTED }
  switch (err.status) {
    case HTTP_NOT_FOUND:
      return {
        kind: 'not_found',
        message: `No manifest ${manifestNumber} was found. Check the number on the client's manifest.`,
      }
    case HTTP_NOT_IMPLEMENTED:
      return { kind: 'unsupported', message: err.message }
    case NO_RESPONSE:
      return { kind: 'retryable', message: LOOKUP_NO_RESPONSE }
    case HTTP_BAD_GATEWAY:
    case HTTP_GATEWAY_TIMEOUT:
      return { kind: 'retryable', message: err.message }
    default:
      return { kind: 'rejected', message: err.message }
  }
}

export type CreateFailure =
  | { kind: 'no_response' }
  | { kind: 'manifest_changed'; message: string; preview: PPManifestPreview }
  | { kind: 'already_on_trip'; message: string; tripId: string | null; tripReference: string | null }
  | { kind: 'rejected'; message: string }

export function classifyCreateError(err: unknown): CreateFailure {
  if (!(err instanceof ApiError)) return { kind: 'rejected', message: UNEXPECTED }
  if (err.status === NO_RESPONSE) return { kind: 'no_response' }

  const detail = isRecord(err.detail) ? err.detail : null
  const preview = detail?.preview
  if (err.status === HTTP_CONFLICT && detail?.code === CODE_MANIFEST_CHANGED && isPreview(preview)) {
    return { kind: 'manifest_changed', message: err.message, preview }
  }
  if (err.status === HTTP_CONFLICT && detail?.code === CODE_MANIFEST_ALREADY_ON_TRIP) {
    return {
      kind: 'already_on_trip',
      message: err.message,
      tripId: stringOrNull(detail.trip_id),
      tripReference: stringOrNull(detail.trip_reference),
    }
  }
  return { kind: 'rejected', message: err.message }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Tells the fresh preview inside a 409 MANIFEST_CHANGED body from anything else. The
 *  server builds it with the same PPManifestPreviewResponse model as GET
 *  /trips/pp-manifest-preview, whose answers the client already takes as typed, so this
 *  checks identity, not every field: re-validating the whole schema here would duplicate
 *  it, and drift with it. */
export function isPreview(value: unknown): value is PPManifestPreview {
  return isRecord(value)
    && isRecord(value.pp_manifest)
    && typeof value.snapshot_sha256 === 'string'
    && Array.isArray(value.warnings)
    && typeof value.can_create === 'boolean'
}
