// frontend/driver-pwa/lib/offline/retained-drafts.ts
// FP-83: phase evidence drafts are bound to the account and custody period that captured
// them. A draft that does not match whoever is capturing now — written by an older build with
// no record of its capturer, by another account on this phone, or by this driver in an
// earlier custody period (A→B→A) — is never loaded into the step, where submitting it would
// file it as the current work. It is moved, intact, to a retained record the driver can
// review, export or deliberately discard (contract v1, "Legacy local evidence boundary").
import type { CustodyStamp } from '@/lib/session/custody-context'

const DRAFT_PREFIX = 'fp_draft_'
const RETAINED_PREFIX = 'fp_retained_draft_'
const DRAFT_FORMAT_VERSION = 2
const DRAFT_MIGRATION_KEY = 'fp_draft_version'

interface StoredDraft {
  v: typeof DRAFT_FORMAT_VERSION
  actorId: string | null
  custodySequence: number | null
  draft: Record<string, unknown>
}

export interface RetainedDraft {
  id: string
  tripId: string
  phaseEventId: string
  /** null when nobody recorded who captured it. */
  actorId: string | null
  custodySequence: number | null
  /** True when the capturer is unknown: never attributed to the signed-in driver. */
  quarantined: boolean
  reason: string
  draft: unknown
  retainedAt: string
}

const UNKNOWN_CAPTURER_REASON = 'Saved by an earlier version of the app, before it recorded who captured it.'
const EARLIER_PERIOD_REASON = 'Captured during an earlier period of yours on this trip. It cannot be submitted as current work.'
const OTHER_ACCOUNT_REASON = 'Captured by another driver account on this phone.'

function storage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null
}

export function draftKey(tripId: string, phaseEventId: string): string {
  return `${DRAFT_PREFIX}${tripId}_${phaseEventId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredDraft(value: unknown): value is StoredDraft {
  return isRecord(value) && value.v === DRAFT_FORMAT_VERSION && isRecord(value.draft)
}

// Ids in the key are UUIDs (hyphens, never underscores), so the first underscore after the
// prefix separates trip from phase event.
function parseDraftKey(key: string): { tripId: string; phaseEventId: string } | null {
  if (!key.startsWith(DRAFT_PREFIX)) return null
  const rest = key.slice(DRAFT_PREFIX.length)
  const split = rest.indexOf('_')
  if (split <= 0) return null
  return { tripId: rest.slice(0, split), phaseEventId: rest.slice(split + 1) }
}

/**
 * Copies a draft into the retained area and only then removes the original, re-reading the
 * copy first: the original is never deleted unless the retained copy is durably there.
 * Returns whether the move completed.
 */
function retain(key: string, record: Omit<RetainedDraft, 'id' | 'retainedAt'>): boolean {
  const store = storage()
  if (store === null) return false
  const id = crypto.randomUUID()
  const retained: RetainedDraft = { ...record, id, retainedAt: new Date().toISOString() }
  const retainedKey = `${RETAINED_PREFIX}${id}`
  try {
    const serialised = JSON.stringify(retained)
    store.setItem(retainedKey, serialised)
    if (store.getItem(retainedKey) !== serialised) return false
    store.removeItem(key)
    return true
  } catch (err) {
    console.warn('retained-drafts: could not retain a draft; it stays where it was', err)
    return false
  }
}

function mismatch(stored: StoredDraft, stamp: CustodyStamp): string | null {
  if (stored.actorId === null) return UNKNOWN_CAPTURER_REASON
  if (stored.actorId !== stamp.actorId) return OTHER_ACCOUNT_REASON
  // Unknown is compatible only before any transfer; returning A must not relabel it.
  if (stored.custodySequence === null && stamp.custodySequence !== null && stamp.custodySequence > 0) {
    return EARLIER_PERIOD_REASON
  }
  if (stored.custodySequence !== null && stamp.custodySequence !== null && stored.custodySequence !== stamp.custodySequence) {
    return EARLIER_PERIOD_REASON
  }
  return null
}

/**
 * The draft for this phase if, and only if, it was captured by `stamp`'s driver in
 * `stamp`'s custody period. Anything else is retained (see the header) and null returned.
 * When the move cannot complete the original is left untouched and still not loaded.
 */
export function readDraft(tripId: string, phaseEventId: string, stamp: CustodyStamp): Record<string, unknown> | null {
  const key = draftKey(tripId, phaseEventId)
  let raw: string | null
  try {
    raw = storage()?.getItem(key) ?? null
  } catch {
    return null
  }
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = raw
  }
  if (!isStoredDraft(parsed)) {
    retain(key, { tripId, phaseEventId, actorId: null, custodySequence: null, quarantined: true, reason: UNKNOWN_CAPTURER_REASON, draft: parsed })
    return null
  }
  const reason = mismatch(parsed, stamp)
  if (reason !== null) {
    retain(key, {
      tripId,
      phaseEventId,
      actorId: parsed.actorId,
      custodySequence: parsed.custodySequence,
      quarantined: parsed.actorId === null,
      reason,
      draft: parsed.draft,
    })
    return null
  }
  return parsed.draft
}

/** Throws on a storage failure so the caller can say the draft was not kept. */
export function writeDraft(tripId: string, phaseEventId: string, stamp: CustodyStamp, draft: object): void {
  const store = storage()
  const key = draftKey(tripId, phaseEventId)
  // A previous retention may have failed (quota/private mode). Never overwrite its only
  // durable copy with the next driver's or period's work, even if the new form is blank.
  readDraft(tripId, phaseEventId, stamp)
  const remaining = store?.getItem(key) ?? null
  if (remaining !== null) {
    const previous: unknown = JSON.parse(remaining)
    if (!isStoredDraft(previous) || mismatch(previous, stamp) !== null) {
      throw new Error('The previous draft could not be retained; its original evidence is still stored.')
    }
  }
  const stored: StoredDraft = {
    v: DRAFT_FORMAT_VERSION,
    actorId: stamp.actorId,
    custodySequence: stamp.custodySequence,
    draft: draft as Record<string, unknown>,
  }
  store?.setItem(key, JSON.stringify(stored))
}

/** An old submission's completion must never delete a successor's draft for the same phase. */
export function removeDraft(tripId: string, phaseEventId: string, stamp: CustodyStamp, expectedValue: string | null): void {
  const store = storage()
  const key = draftKey(tripId, phaseEventId)
  const raw = store?.getItem(key) ?? null
  if (raw === null || raw !== expectedValue) return
  const previous: unknown = JSON.parse(raw)
  if (isStoredDraft(previous) && previous.actorId === stamp.actorId
      && (previous.custodySequence === stamp.custodySequence
        || (previous.custodySequence === null && stamp.custodySequence === 0))) store?.removeItem(key)
}

/**
 * One-time sweep of drafts saved before FP-83, so a draft for a phase the driver never
 * reopens is also quarantined and shown for review. Rerunnable: the marker is written only
 * after every legacy draft moved, and a draft that could not move is picked up next run.
 */
export function migrateLegacyDrafts(): void {
  const store = storage()
  if (store === null) return
  try {
    if (Number(store.getItem(DRAFT_MIGRATION_KEY)) >= DRAFT_FORMAT_VERSION) return
    const keys: string[] = []
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (key !== null && key.startsWith(DRAFT_PREFIX)) keys.push(key)
    }
    let complete = true
    for (const key of keys) {
      const ids = parseDraftKey(key)
      const raw = store.getItem(key)
      if (ids === null || raw === null) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
      if (isStoredDraft(parsed)) continue
      const moved = retain(key, {
        ...ids, actorId: null, custodySequence: null, quarantined: true, reason: UNKNOWN_CAPTURER_REASON, draft: parsed,
      })
      if (!moved) complete = false
    }
    if (complete) store.setItem(DRAFT_MIGRATION_KEY, String(DRAFT_FORMAT_VERSION))
  } catch (err) {
    console.warn('retained-drafts: legacy draft migration did not complete; will retry', err)
  }
}

export function listRetainedDrafts(): RetainedDraft[] {
  const store = storage()
  if (store === null) return []
  const drafts: RetainedDraft[] = []
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (key === null || !key.startsWith(RETAINED_PREFIX)) continue
      const raw = store.getItem(key)
      if (raw === null) continue
      try {
        drafts.push(JSON.parse(raw) as RetainedDraft)
      } catch (err) {
        console.warn(`retained-drafts: unreadable retained draft "${key}" left in place`, err)
      }
    }
  } catch (err) {
    console.warn('retained-drafts: could not list retained drafts', err)
  }
  return drafts.sort((a, b) => a.retainedAt.localeCompare(b.retainedAt))
}

/** The driver's deliberate, confirmed discard of one retained draft. */
export function discardRetainedDraft(id: string): void {
  try {
    storage()?.removeItem(`${RETAINED_PREFIX}${id}`)
  } catch (err) {
    console.warn('retained-drafts: could not discard a retained draft', err)
  }
}
