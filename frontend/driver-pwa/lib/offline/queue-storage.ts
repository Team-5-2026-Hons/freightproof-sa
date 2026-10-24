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
// Bumped once per incompatible entry format. 2: every entry records its capturing
// account and custody period, and entries without an account are quarantined.
const QUEUE_VERSION_KEY = 'fp_offline_queue_version'
const QUEUE_VERSION = 2
// Where an unparseable queue value is preserved before anything writes over the key.
const UNREADABLE_QUEUE_BACKUP_KEY = 'fp_offline_queue_unreadable'

/**
 * 'pending' sends automatically. 'needs-attention' was refused and waits for the driver.
 * 'quarantined' has no trustworthy record of who captured it: kept, never sent, never shown
 * as the signed-in driver's work.
 */
export type QueueItemStatus = 'pending' | 'needs-attention' | 'quarantined'

/** Custody fields on every queued capture. All optional only because version-1 entries lack them. */
export interface QueueItemCustody {
  /** Capturing account. `undefined` = written before this field existed. */
  actorId?: string | null
  /** Custody period at capture. null = the server had sent none. */
  custodySequence?: number | null
  status?: QueueItemStatus
  attention?: RetainedAttention | null
}

// Addresses one specific PhaseEvent row via phaseEventId — phaseType alone is ambiguous
// on a cross-dock plan (unloading can occur more than once).
export interface PhaseQueueEntry extends QueueItemCustody {
  kind: 'phase'
  id: string
  tripId: string
  phaseEventId: string
  phaseType: PhaseType
  evidence: PhaseEvidence
  // Wire idempotency_key — generated once at enqueue (same value as `id`) and never
  // regenerated on retry, so every replay sends the exact key the first attempt sent.
  idempotencyKey: string
  // Captured silently at swipe time and stored with the entry, not re-taken at replay —
  // a late ping would falsely claim the driver was wherever signal returned.
  position: DriverPosition | null
  // Stamped at swipe time and stored with the entry — a replay hours later must report
  // the original instant, not the flush-time clock, or the backend's skew check misfires.
  driverCapturedAt: string
  // Acknowledgement is evidence of the warning the driver saw at the original
  // attempt. It must travel with the queued capture, never be requested on replay.
  acknowledgement: LocationWarningAcknowledgement | null
  enqueuedAt: string
}

// No separate upload-then-complete sequence: submitCheckpoint already does both.
export interface CheckpointQueueEntry extends QueueItemCustody {
  kind: 'checkpoint'
  id: string
  tripId: string
  evidence: CheckpointEvidence
  enqueuedAt: string
}

// Queued as a batch — several fixes from a dead zone, replayed in one call once signal
// returns. No idempotency key needed: a duplicated ping is just a duplicate trail row.
export interface LocationQueueEntry extends QueueItemCustody {
  kind: 'location'
  id: string
  tripId: string
  pings: LocationPingBody[]
  enqueuedAt: string
}

// A stored value the migration could not read as any known entry. Kept verbatim so it can
// be exported for review; never sent and never interpreted.
export interface UnreadableQueueEntry {
  kind: 'unreadable'
  id: string
  raw: unknown
  status: 'quarantined'
  actorId: null
  enqueuedAt: string
}

export type SendableQueueEntry = PhaseQueueEntry | CheckpointQueueEntry | LocationQueueEntry

// Exceptions no longer queue here: they live in IndexedDB (lib/offline/exception-store.ts)
// because their photos are Blobs. The legacy shape stays in the union only so entries
// written by the previous build are still read, migrated, and — if migration cannot run —
// left untouched rather than dropped.
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
    // Unreadable — treated as nothing pending. The migration has already preserved the raw
    // value under UNREADABLE_QUEUE_BACKUP_KEY before any write could replace it.
    return []
  }
}

// Returns whether the write landed, so callers relying on it (a queued exception) can
// tell "saved for later" from "gone on refresh".
export function saveQueue(entries: QueueEntry[]): boolean {
  // A write before the migration could overwrite an unreadable legacy value that nobody has
  // preserved yet. Migrate first; if that cannot complete, refuse rather than risk it.
  if (!migrateQueueForCustody()) return false
  return writeQueue(entries)
}

function writeQueue(entries: QueueEntry[]): boolean {
  try {
    storage()?.setItem(QUEUE_KEY, JSON.stringify(entries))
    return true
  } catch {
    // Quota exceeded or storage disabled — still updates in memory, won't survive reload.
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
  // Legacy exception entries keep their own migration into IndexedDB, which quarantines them.
  if (value.kind === 'exception') return value as unknown as LegacyExceptionEntry
  if (!SENDABLE_KINDS.has(value.kind) || typeof value.tripId !== 'string') {
    return { kind: 'unreadable', id: value.id, raw: value, status: 'quarantined', actorId: null, enqueuedAt: now }
  }
  const entry = value as unknown as SendableQueueEntry
  // Already version 2 (written by this build, or an interrupted earlier run): untouched.
  if (entry.actorId !== undefined) return entry
  // No record of who captured it. The current login or the trip's current driver is NOT
  // proof (contract v1, "Legacy local evidence boundary"), so it is kept but never sent.
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
      // Not a list at all. Preserve the exact bytes first; only once that copy is durable may
      // the queue key be reset, so nothing is lost even if this is a value we cannot read.
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
