// Plain-English wording for a completed driver transfer, shared by the timeline card and the
// Info panel's history so the two never describe the same record in different words.

import type { RequestFormat, SealCheck, SubstitutionCompletionMode, SubstitutionNoticeKind, SubstitutionSealCondition } from '@shared/lib/types/driver-substitution'
import type { ActionLocationAssessment } from '@shared/lib/types/action-location'
import type { IdvsStatus } from '@shared/lib/types/driver'
import type { AnchorStatus } from '@shared/lib/types/phase'
import { PROXIMITY_LABELS, PROXIMITY_REASON_LABELS } from '@/lib/phase/location-evidence'

export const NOT_RECORDED = 'Not recorded'

export const COMPLETION_MODE_LABELS: Record<SubstitutionCompletionMode, string> = {
  normal: 'Driver accepted',
  dispatcher_attested: 'Completed by dispatcher',
}

// "Sealed" is the dispatcher-facing word for a Hedera anchor; `not_required` is a record that
// never needed one, which is different from one still waiting.
export const ANCHOR_STATUS_LABELS: Record<AnchorStatus, string> = {
  anchored: 'Sealed on Hedera',
  pending: 'Sealing pending',
  failed: 'Sealing failed',
  not_required: 'Not sealed',
}

// Legacy planned requests needed both drivers to confirm; only the immediate format is the incoming
// driver's acceptance alone. The two read differently to someone checking who agreed to what.
const BOTH_DRIVERS_CONFIRMED = 'Both drivers confirmed'
const INCOMING_ONLY_FORMAT: RequestFormat = 'immediate_v2'

/** How the transfer was completed, or "Not recorded" for a legacy row with no mode. A normal
 *  completion of anything but an immediate-format request was confirmed by both drivers. */
export function fmtCompletionMode(mode: SubstitutionCompletionMode | null, requestFormat?: RequestFormat | null): string {
  if (mode === null) return NOT_RECORDED
  return mode === 'normal' && requestFormat !== INCOMING_ONLY_FORMAT ? BOTH_DRIVERS_CONFIRMED : COMPLETION_MODE_LABELS[mode]
}

/** Where the transfer's seal stands, or "Not recorded" when the row carries no anchor status. */
export function fmtAnchorStatus(status: AnchorStatus | null): string {
  return status === null ? NOT_RECORDED : ANCHOR_STATUS_LABELS[status]
}

/** "Driver accepted · Sealed on Hedera": the one line a transfer card shows under its time. */
export function fmtTransferOutcome(mode: SubstitutionCompletionMode | null, anchor: AnchorStatus | null, requestFormat?: RequestFormat | null): string {
  return `${fmtCompletionMode(mode, requestFormat)} · ${fmtAnchorStatus(anchor)}`
}

export const SEAL_CONDITION_LABELS: Record<SubstitutionSealCondition, string> = {
  intact: 'Intact',
  damaged: 'Damaged',
  missing: 'Missing',
  not_applicable: 'No seal (empty leg)',
}

export const IDENTITY_STATUS_LABELS: Record<IdvsStatus, string> = {
  verified: 'Verified',
  pending: 'Not yet verified',
  failed: 'Verification failed',
}

export const NOTICE_KIND_LABELS: Record<SubstitutionNoticeKind, string> = {
  arranged: 'Transfer arranged',
  cancelled: 'Transfer cancelled',
  completed: 'Transfer completed',
}

/** "Intact · FP-1233", or "No seal (empty leg) · <why>" when the leg carried none. The vehicle is the row's label. */
export function fmtSealCheck(check: SealCheck): string {
  const detail = check.seal_number ?? check.not_applicable_reason
  return detail ? `${SEAL_CONDITION_LABELS[check.condition]} · ${detail}` : SEAL_CONDITION_LABELS[check.condition]
}

/** The proximity verdict a capture stored, with the reasons spelled out when it could not compare. */
export function fmtProximity(assessment: ActionLocationAssessment | null | undefined): string {
  if (!assessment) return 'Not assessed'
  const verdict = PROXIMITY_LABELS[assessment.proximity]
  if (assessment.proximity === 'separated' && assessment.separation_metres !== null) {
    return `${verdict} · ${Math.round(assessment.separation_metres)} m apart`
  }
  if (assessment.proximity === 'unverified' && assessment.reasons.length > 0) {
    const reasons = assessment.reasons.map(reason => PROXIMITY_REASON_LABELS[reason]).join('; ')
    return `${verdict}: ${reasons}`
  }
  return verdict
}
