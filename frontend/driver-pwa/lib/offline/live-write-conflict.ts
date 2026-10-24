// What a failed send of queued driver evidence means, decided from the server's coded
// answer — never from the HTTP status alone. Before driver substitution the queue read every
// 409 as "an earlier attempt already landed" and dropped the entry. That is no longer true: a
// 409 can now mean the driver handed the trip over, or the capture belongs to an earlier
// custody period, and dropping either would delete evidence (contract v1, "Stable errors":
// "Do not treat every 409 as a duplicate ... A new unrecognised conflict is needs-attention,
// never evidence deletion").
import { ApiError, type DriverConflictCode } from '@/lib/api/client'

/** Why a queued capture stopped sending, kept with it until the driver decides. */
export interface RetainedAttention {
  /** The server's stable code, or null for a legacy uncoded refusal. */
  code: DriverConflictCode | null
  /** HTTP status of the refusal; 0 for a local problem (unreadable photo). */
  status: number
  /** Driver-facing explanation. */
  reason: string
  /**
   * The capture belongs to a period this driver no longer holds, so the only honest route
   * left is the late-evidence endpoint. Still subject to the item having a known actor and
   * custody period — the sender checks both.
   */
  lateEligible: boolean
  /** When the refusal happened (ISO), so a review screen can order and date it. */
  at: string
}

export type LiveWriteFailure =
  /** Network, timeout, 5xx, 429, an expired sign-in: keep and retry under the existing policy. */
  | { kind: 'transient'; retryAfterMs: number | null }
  /**
   * EVIDENCE_ALREADY_RECORDED: the server proved THIS actor's exact earlier send landed. The
   * only failure that may clear a queued item, and only the one item that was sent.
   */
  | { kind: 'duplicate'; evidenceId: string | null }
  /** Anything the server refused: kept intact, needs the driver. */
  | { kind: 'retain'; attention: RetainedAttention }

const HTTP_UNAUTHORIZED = 401
const HTTP_REQUEST_TIMEOUT = 408
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_CLIENT_ERROR_MIN = 400
const HTTP_SERVER_ERROR_MIN = 500
// A 429 without Retry-After must still schedule a retry: a null delay would leave the item
// waiting for an unrelated flush trigger.
export const DEFAULT_RATE_LIMIT_RETRY_MS = 60_000

const CODED_REASONS: Partial<Record<DriverConflictCode, string>> = {
  TRIP_HANDED_OVER:
    'You handed this trip over before this was sent. It is kept on this phone. Send it as late evidence.',
  CUSTODY_CONTEXT_CHANGED:
    'The trip changed driver after you captured this. It is kept under the period you captured it in. Send it as late evidence.',
  CUSTODY_CONTEXT_REQUIRED:
    'This was captured before the app recorded the custody period, so it cannot be sent on its own. Keep it for review or export it.',
  IDEMPOTENCY_KEY_REUSED:
    'The server already holds a different version of this capture. It is kept on this phone for review.',
}

// Codes whose capture can still reach the record, through the late-evidence route.
const LATE_ELIGIBLE: ReadonlySet<DriverConflictCode> = new Set<DriverConflictCode>([
  'TRIP_HANDED_OVER',
  'CUSTODY_CONTEXT_CHANGED',
])

// Only the defensive paths (an older backend that answers 200 or an uncoded 409 for an overridden
// phase) need this; a coded PHASE_OVERRIDDEN carries the server's own message, which is the same
// sentence. Deliberately not in CODED_REASONS, which would replace the server's wording.
export const PHASE_OVERRIDDEN_REASON =
  'The dispatcher closed this step while your capture was waiting. It is kept on this phone.'

const UNRECOGNISED_REASON = 'The server did not accept this. It is kept on this phone for review.'

export function retainedAttention(code: DriverConflictCode | null, status: number, message: string): RetainedAttention {
  return {
    code,
    status,
    reason: (code !== null ? CODED_REASONS[code] : undefined) ?? (message || UNRECOGNISED_REASON),
    lateEligible: code !== null && LATE_ELIGIBLE.has(code),
    at: new Date().toISOString(),
  }
}

export function classifyLiveWriteFailure(err: unknown): LiveWriteFailure {
  if (!(err instanceof ApiError)) return { kind: 'transient', retryAfterMs: null }
  if (err.status === HTTP_TOO_MANY_REQUESTS) {
    return { kind: 'transient', retryAfterMs: err.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS }
  }
  // Statuses about the session or the timing, not the evidence: wait, never park.
  if (err.status === 0 || err.status === HTTP_UNAUTHORIZED || err.status === HTTP_REQUEST_TIMEOUT) {
    return { kind: 'transient', retryAfterMs: null }
  }
  if (err.status < HTTP_CLIENT_ERROR_MIN || err.status >= HTTP_SERVER_ERROR_MIN) {
    return { kind: 'transient', retryAfterMs: null }
  }
  if (err.code === 'EVIDENCE_ALREADY_RECORDED') {
    return { kind: 'duplicate', evidenceId: err.detail?.evidenceId ?? null }
  }
  return { kind: 'retain', attention: retainedAttention(err.code ?? null, err.status, err.message) }
}

/** Whether a coded answer means the trip itself has moved on from this driver. */
export function isCustodyConflict(attention: RetainedAttention): boolean {
  return attention.code === 'TRIP_HANDED_OVER'
    || attention.code === 'CUSTODY_CONTEXT_CHANGED'
    || attention.code === 'CUSTODY_CONTEXT_REQUIRED'
}

/**
 * Dispatch overrode the phase this capture was for, so it never reached the ledger. Kept apart
 * from isCustodyConflict on purpose: it is NOT offered as late evidence (that route needs a
 * former custody period and would refuse it), and a live resend can only be refused again.
 */
export function isPhaseOverridden(attention: RetainedAttention): boolean {
  return attention.code === 'PHASE_OVERRIDDEN'
}
