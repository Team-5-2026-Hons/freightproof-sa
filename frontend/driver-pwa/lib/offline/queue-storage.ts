// The localStorage half of the offline queue (phase, checkpoint and location captures), its
// entry shapes and its format migration. Split out of useOfflineQueue so the review
// screen and the late-evidence sender read and change the same records the queue sends from,
// rather than keeping a second copy that could drift from it.
import type { PhaseType } from '@shared/lib/types/phase'
import type { PhaseEvidence } from '@/lib/types/evidence-draft'
import type { DriverPosition, LocationWarningAcknowledgement } from '@/lib/types/location'
import type { CheckpointEvidence } from '@/lib/api/checkpoints'
import type { LocationPingBody } from '@/lib/api/locations'
import type { LegacyExceptionEntry } from './legacy-exception-migration'
import type { RetainedAttention } from './live-write-conflict'

export const QUEUE_KEY = 'fp_offline_queue'
const QUEUE_VERSION_KEY = 'fp_offline_queue_version'
const QUEUE_VERSION = 2
const UNREADABLE_QUEUE_BACKUP_KEY = 'fp_offline_queue_unreadable'

/**
 * 'pending' sends automatically. 'needs-attention' was refused and waits for the driver.
 * 'quarantined' has no trustworthy record of who captured it: kept, never sent, never shown
 * as the signed-in driver's work.
 */
export type QueueItemStatus = 'pending' | 'needs-attention' | 'quarantined'

/** Custody fields on every queued capture. All optional only because version-1 entries lack them. */
export interface QueueItemCustody {
  actorId?: string | null
  custodySequence?: number | null
  status?: QueueItemStatus
  attention?: RetainedAttention | null
}

export interface PhaseQueueEntry extends QueueItemCustody {
  kind: 'phase'
  id: string
  tripId: string
  phaseEventId: string
  phaseType: PhaseType
  evidence: PhaseEvidence
  idempotencyKey: string
  position: DriverPosition | null
  driverCapturedAt: string
  acknowledgement: LocationWarningAcknowledgement | null
  enqueuedAt: string
}

export interface CheckpointQueueEntry extends QueueItemCustody {
  kind: 'checkpoint'
  id: string
  tripId: string
  evidence: CheckpointEvidence
  enqueuedAt: string
}

export interface LocationQueueEntry extends QueueItemCustody {
  kind: 'location'
  id: string
  tripId: string
  pings: LocationPingBody[]
  enqueuedAt: string
}

export interface UnreadableQueueEntry {
  kind: 'unreadable'
  id: string
  raw: unknown
  status: 'quarantined'
  actorId: null
  enqueuedAt: string
}

export type SendableQueueEntry = PhaseQueueEntry | CheckpointQueueEntry | LocationQueueEntry

export type QueueEntry = SendableQueueEntry | LegacyExceptionEntry | UnreadableQueueEntry

const SENDABLE_KINDS: ReadonlySet<string> = new Set(['phase', 'checkpoint', 'location'])

export function isSendableEntry(entry: QueueEntry): entry is SendableQueueEntry {
  return SENDABLE_KINDS.has(entry.kind)
}

export function isLegacyException(entry: QueueEntry): entry is LegacyExceptionEntry {
  return entry.kind === 'exception'
}

export function entryStatus(entry: QueueEntry): QueueItemStatus {
  if (entry.kind === 'unreadable') return 'quarantined'
  if (entry.kind === 'exception') return 'pending'
  return entry.status ?? 'pending'
}

function storage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null
}

export function loadQueue(): QueueEntry[] {
  try {
    const raw = storage()?.getItem(QUEUE_KEY) ?? null
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as QueueEntry[]) : []
  } catch {
    return []
  }
}

export function saveQueue(entries: QueueEntry[]): boolean {
  if (!migrateQueueForCustody()) return false
  return writeQueue(entries)
}

function writeQueue(entries: QueueEntry[]): boolean {
  try {
    storage()?.setItem(QUEUE_KEY, JSON.stringify(entries))
    return true
  } catch {
    console.warn(`queue-storage: failed to persist queue for key "${QUEUE_KEY}"`)
    return false
  }
}

/** Read-modify-write of the current stored queue (never a stale snapshot). */
export function updateQueue(change: (entries: QueueEntry[]) => QueueEntry[]): boolean {
  return saveQueue(change(loadQueue()))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function migrateEntry(value: unknown): QueueEntry {
  const now = new Date().toISOString()
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.id !== 'string') {
    return { kind: 'unreadable', id: crypto.randomUUID(), raw: value, status: 'quarantined', actorId: null, enqueuedAt: now }
  }
  if (value.kind === 'exception') return value as unknown as LegacyExceptionEntry
  if (!SENDABLE_KINDS.has(value.kind) || typeof value.tripId !== 'string') {
    return { kind: 'unreadable', id: value.id, raw: value, status: 'quarantined', actorId: null, enqueuedAt: now }
  }
  const entry = value as unknown as SendableQueueEntry
  if (entry.actorId !== undefined) return entry
  return { ...entry, actorId: null, custodySequence: entry.custodySequence ?? null, status: 'quarantined', attention: null }
}

/**
 * One-way, rerunnable move of the queue to version 2. Each step is a single localStorage
 * write, and the version marker is written last, so an interruption at any point leaves
 * either the untouched original or a fully migrated copy — and the next run finishes it.
 * Returns false when it could not complete (storage refused a write).
 */
export function migrateQueueForCustody(): boolean {
  const store = storage()
  if (store === null) return true
  try {
    if (Number(store.getItem(QUEUE_VERSION_KEY)) >= QUEUE_VERSION) return true
    const raw = store.getItem(QUEUE_KEY)
    let parsed: unknown = []
    if (raw !== null) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
    }
    if (!Array.isArray(parsed)) {
      if (raw !== null) {
        store.setItem(UNREADABLE_QUEUE_BACKUP_KEY, raw)
        if (store.getItem(UNREADABLE_QUEUE_BACKUP_KEY) !== raw) return false
      }
      parsed = []
    }
    if (!writeQueue((parsed as unknown[]).map(migrateEntry))) return false
    store.setItem(QUEUE_VERSION_KEY, String(QUEUE_VERSION))
    return true
  } catch (err) {
    console.warn('queue-storage: offline queue migration did not complete; will retry', err)
    return false
  }
}

/** The preserved unparseable queue value, if the migration found one. For export only. */
export function readUnreadableQueueBackup(): string | null {
  try {
    return storage()?.getItem(UNREADABLE_QUEUE_BACKUP_KEY) ?? null
  } catch {
    return null
  }
}

export function clearUnreadableQueueBackup(): void {
  try {
    storage()?.removeItem(UNREADABLE_QUEUE_BACKUP_KEY)
  } catch (err) {
    console.warn('queue-storage: could not remove the unreadable queue backup', err)
  }
}
