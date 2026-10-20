// Pure presentation rules for FP-83 driver substitution. No I/O, no React.
//
// Everything here READS the server's answer; nothing decides custody. Who is current, whether
// a transfer completed and why it is blocked all come from the contract fields — this module
// only turns them into the driver's words.

import type {
  DriverContact,
  SubstitutionCompletionBlocker,
  SubstitutionNoticeKind,
  SubstitutionRequestRead,
  SubstitutionRole,
} from '@shared/lib/types/driver-substitution'
import type { IdvsStatus } from '@shared/lib/types/driver'

/**
 * This driver's side of an arrangement. The named contacts are authoritative; the permitted
 * actions are only a fallback, because they empty out once the driver has confirmed. null
 * means the request does not name this driver at all — the caller shows nothing rather than
 * guessing a role.
 */
export function substitutionRoleFor(request: SubstitutionRequestRead, driverId: string): SubstitutionRole | null {
  if (request.incoming.id === driverId) return 'incoming'
  if (request.outgoing.id === driverId) return 'outgoing'
  if (request.permitted_actions.includes('confirm_incoming')) return 'incoming'
  if (request.permitted_actions.includes('confirm_outgoing')) return 'outgoing'
  return null
}

export function counterpartOf(request: SubstitutionRequestRead, role: SubstitutionRole): DriverContact {
  return role === 'incoming' ? request.outgoing : request.incoming
}

export function hasConfirmed(request: SubstitutionRequestRead, role: SubstitutionRole): boolean {
  return request.confirmations.some((confirmation) => confirmation.role === role)
}

// Why a saved confirmation has not transferred custody yet. Worded for the driver: each one
// says the capture is kept, because the contract guarantees it is (HTTP 200, not an error).
const BLOCKER_COPY: Record<SubstitutionCompletionBlocker, string> = {
  incoming_driver_inactive: 'The incoming driver’s account is not active. Your dispatcher must choose another driver.',
  licence_invalid: 'The incoming driver’s licence expiry is missing or past. Dispatch must resolve it before the handover can complete.',
  driver_unavailable: 'The incoming driver is booked on other work. Your dispatcher must resolve it.',
  identity_not_verified: 'The incoming driver’s identity is not verified yet. An admin at dispatch must review it.',
}

export function blockerMessage(blocker: SubstitutionCompletionBlocker): string {
  return BLOCKER_COPY[blocker]
}

// The recorded fleet status, never a fresh check — the app runs no identity session of its
// own, so it must not word PENDING as if a verification were in progress on this phone.
const IDENTITY_COPY: Record<IdvsStatus, string> = {
  verified: 'Identity verified on the fleet record',
  pending: 'Identity not yet verified — an admin at dispatch must review it',
  failed: 'Identity verification failed — this handover cannot complete',
}

export function identityLabel(status: IdvsStatus): string {
  return IDENTITY_COPY[status]
}

/**
 * The one-line state of an arrangement for this driver. Completion and cancellation are the
 * server's terminal states; "pending" is split by what is still missing, so a driver who has
 * already confirmed is never asked to do it again.
 */
export function substitutionStatusLine(request: SubstitutionRequestRead, role: SubstitutionRole): string {
  if (request.state === 'completed') return 'Handover complete'
  if (request.state === 'cancelled') {
    return request.replacement_request_id !== null ? 'Replaced by a new arrangement' : 'Handover cancelled'
  }
  if (request.request_format === 'immediate_v2' && role === 'outgoing') {
    return hasConfirmed(request, 'incoming') ? 'Incoming acceptance saved — waiting on dispatch' : 'Transfer authorised — waiting for incoming driver'
  }
  if (request.completion_blocked_by !== null) return 'Saved — waiting on dispatch'
  if (!hasConfirmed(request, role)) return 'Waiting for your handover check'
  const other = role === 'incoming' ? 'outgoing' : 'incoming'
  return request.missing_confirmations.includes(other)
    ? `Waiting for ${counterpartOf(request, role).full_name}`
    : 'Waiting for the server to complete the handover'
}

interface NoticeCopy {
  title: string
  body: string
}

const NOTICE_COPY: Record<SubstitutionNoticeKind, NoticeCopy> = {
  arranged: {
    title: 'Driver handover arranged',
    body: 'Dispatch has arranged a driver change on this trip.',
  },
  cancelled: {
    title: 'Driver handover cancelled',
    body: 'The arrangement no longer applies. Nothing you have recorded is lost.',
  },
  completed: {
    title: 'Driver handover complete',
    body: 'Custody of this trip has changed. Open it to see where you stand now.',
  },
}

export function noticeCopy(kind: SubstitutionNoticeKind): NoticeCopy {
  return NOTICE_COPY[kind]
}
