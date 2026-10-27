// One read-only view over everything this phone is holding for the driver's decision —
// refused queue entries, refused exception reports, quarantined captures of unknown origin,
// retained drafts and the unreadable-queue backup — plus the explicit actions on each one.
// Nothing here deletes evidence except discardRetainedItem, which only the review screen
// calls after its own warning and second tap.
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { currentActorId } from '@/lib/session/custody-context'
import { blobToDataUrl } from './exception-sync'
import {
  listExceptionEnvelopes,
  removeExceptionEnvelope,
  resetExceptionToPending,
  type ExceptionEnvelope,
} from './exception-store'
import { isCustodyConflict, isPhaseOverridden, type RetainedAttention } from './live-write-conflict'
import {
  clearUnreadableQueueBackup,
  entryStatus,
  isSendableEntry,
  loadQueue,
  readUnreadableQueueBackup,
  updateQueue,
  type QueueEntry,
} from './queue-storage'
import { discardRetainedDraft, listRetainedDrafts, type RetainedDraft } from './retained-drafts'
import { lateEvidenceBlocker, type LateEvidenceSource } from './late-evidence-sync'
import { listLateProgress, type LateEvidenceProgress } from './substitution-store'

export type RetainedRef =
  | { origin: 'queue'; id: string }
  | { origin: 'exception'; id: string }
  | { origin: 'draft'; id: string }
  | { origin: 'queue-backup' }

export interface RetainedItem {
  ref: RetainedRef
  title: string
  tripId: string | null
  capturedAt: string | null
  reason: string
  quarantined: boolean
  canRetry: boolean
  late: LateEvidenceSource | null
}

export interface RetainedEvidenceSnapshot {
  items: RetainedItem[]
  heldForOtherAccounts: number
  receipts: LateEvidenceProgress[]
}

const QUARANTINE_REASON = 'Saved before this app recorded who captured it. It is kept on this phone and will not be sent.'
const UNREADABLE_REASON = 'Stored data this version of the app cannot read. It is kept so it can be exported.'

function queueTitle(entry: QueueEntry): string {
  switch (entry.kind) {
    case 'phase': return `${PHASE_NAMES[entry.phaseType]} evidence`
    case 'checkpoint': return 'Checkpoint'
    case 'location': return 'Location report'
    case 'exception': return 'Incident report'
    case 'unreadable': return 'Unreadable saved item'
  }
}

function queueCapturedAt(entry: QueueEntry): string | null {
  switch (entry.kind) {
    case 'phase': return entry.driverCapturedAt
    case 'checkpoint': return entry.evidence.capturedAt
    case 'location': return entry.pings[0]?.recorded_at ?? entry.enqueuedAt
    case 'exception': return entry.enqueuedAt
    case 'unreadable': return null
  }
}

function attentionFields(attention: RetainedAttention | null | undefined, fallback: string): Pick<RetainedItem, 'reason' | 'canRetry'> {
  return {
    reason: attention?.reason ?? fallback,
    canRetry: attention != null && !isCustodyConflict(attention) && !isPhaseOverridden(attention),
  }
}

function lateFor(source: LateEvidenceSource): LateEvidenceSource | null {
  return lateEvidenceBlocker(source) === null ? source : null
}

function draftItem(draft: RetainedDraft): RetainedItem {
  return {
    ref: { origin: 'draft', id: draft.id },
    title: 'Unsubmitted phase draft',
    tripId: draft.tripId,
    capturedAt: draft.retainedAt,
    reason: draft.reason,
    quarantined: draft.quarantined,
    canRetry: false,
    late: null,
  }
}

function envelopeItem(envelope: ExceptionEnvelope): RetainedItem {
  const quarantined = envelope.status === 'quarantined'
  return {
    ref: { origin: 'exception', id: envelope.clientReportId },
    title: 'Incident report',
    tripId: envelope.tripId,
    capturedAt: envelope.body.driver_captured_at ?? envelope.createdAt,
    ...(quarantined
      ? { reason: QUARANTINE_REASON, canRetry: false }
      : attentionFields(envelope.attention, envelope.attentionReason ?? 'The server did not accept this report.')),
    quarantined,
    late: quarantined ? null : lateFor({ origin: 'exception', envelope }),
  }
}

export async function listRetainedEvidence(): Promise<RetainedEvidenceSnapshot> {
  const actorId = currentActorId()
  const items: RetainedItem[] = []
  let heldForOtherAccounts = 0

  for (const entry of loadQueue()) {
    const status = entryStatus(entry)
    if (status === 'pending') continue
    if (status === 'quarantined') {
      items.push({
        ref: { origin: 'queue', id: entry.id },
        title: queueTitle(entry),
        tripId: 'tripId' in entry ? entry.tripId : null,
        capturedAt: queueCapturedAt(entry),
        reason: entry.kind === 'unreadable' ? UNREADABLE_REASON : QUARANTINE_REASON,
        quarantined: true,
        canRetry: false,
        late: null,
      })
      continue
    }
    if (!isSendableEntry(entry)) continue
    if (entry.actorId !== actorId) {
      heldForOtherAccounts += 1
      continue
    }
    items.push({
      ref: { origin: 'queue', id: entry.id },
      title: queueTitle(entry),
      tripId: entry.tripId,
      capturedAt: queueCapturedAt(entry),
      ...attentionFields(entry.attention, 'The server did not accept this.'),
      quarantined: false,
      late: lateFor({ origin: 'queue', entry }),
    })
  }

  if (readUnreadableQueueBackup() !== null) {
    items.push({
      ref: { origin: 'queue-backup' },
      title: 'Unreadable saved queue',
      tripId: null,
      capturedAt: null,
      reason: UNREADABLE_REASON,
      quarantined: true,
      canRetry: false,
      late: null,
    })
  }

  try {
    for (const envelope of await listExceptionEnvelopes()) {
      if (envelope.status === 'pending') continue
      if (envelope.status === 'needs-attention' && envelope.actorId !== actorId) {
        heldForOtherAccounts += 1
        continue
      }
      items.push(envelopeItem(envelope))
    }
  } catch (err) {
    console.warn('retained-evidence: could not read incident reports', err)
  }

  for (const draft of listRetainedDrafts()) {
    if (!draft.quarantined && draft.actorId !== actorId) {
      heldForOtherAccounts += 1
      continue
    }
    items.push(draftItem(draft))
  }

  let receipts: LateEvidenceProgress[] = []
  try {
    receipts = (await listLateProgress()).filter((p) => p.receipt !== null && p.actorId === actorId)
  } catch (err) {
    console.warn('retained-evidence: could not read late-evidence receipts', err)
  }

  return { items, heldForOtherAccounts, receipts }
}

/** The driver's "Try again" on one non-custody refusal. Same keys, so nothing duplicates. */
export async function retryRetainedItem(ref: RetainedRef): Promise<void> {
  if (ref.origin === 'exception') {
    await resetExceptionToPending(ref.id)
    return
  }
  if (ref.origin !== 'queue') return
  updateQueue((entries) => entries.map((entry) => (
    entry.id === ref.id && isSendableEntry(entry) && entry.status === 'needs-attention'
      ? { ...entry, status: 'pending' as const, attention: null }
      : entry
  )))
}

/** The driver's confirmed, deliberate discard of one retained item. */
export async function discardRetainedItem(ref: RetainedRef): Promise<void> {
  switch (ref.origin) {
    case 'queue':
      updateQueue((entries) => entries.filter((entry) => entry.id !== ref.id))
      return
    case 'exception':
      await removeExceptionEnvelope(ref.id)
      return
    case 'draft':
      discardRetainedDraft(ref.id)
      return
    case 'queue-backup':
      clearUnreadableQueueBackup()
      return
  }
}

/**
 * Everything stored for one item, as JSON the driver can save and hand to dispatch. Photos
 * are included as data URLs. States plainly when the capturer is unknown — an export never
 * claims the signed-in driver captured a quarantined item.
 */
export async function exportRetainedItem(ref: RetainedRef): Promise<string> {
  let record: unknown = null
  switch (ref.origin) {
    case 'queue':
      record = loadQueue().find((entry) => entry.id === ref.id) ?? null
      break
    case 'queue-backup':
      record = readUnreadableQueueBackup()
      break
    case 'draft':
      record = listRetainedDrafts().find((draft) => draft.id === ref.id) ?? null
      break
    case 'exception': {
      const envelope = (await listExceptionEnvelopes()).find((e) => e.clientReportId === ref.id) ?? null
      if (envelope !== null) {
        const photos = await Promise.all(envelope.photos.map(async (photo) => ({
          ...photo,
          blob: undefined,
          dataUrl: photo.blob !== null ? await blobToDataUrl(photo.blob) : null,
        })))
        record = { ...envelope, photos }
      }
      break
    }
  }
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    exportedWhileSignedInAs: currentActorId(),
    note: 'Exported from the FreightProof driver app. The signed-in account is not necessarily the capturer; see actorId.',
    record,
  }, null, 2)
}
