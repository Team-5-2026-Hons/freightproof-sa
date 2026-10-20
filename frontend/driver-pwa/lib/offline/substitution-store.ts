// frontend/driver-pwa/lib/offline/substitution-store.ts
// FP-83 durable local state, in native IndexedDB (same reasons and patterns as
// exception-store.ts: photos are too big for localStorage, and a capture must survive a dead
// battery or a killed app):
//   * `captures` — this driver's handover/takeover check for one arrangement, from the first
//     tap to the server's answer. It carries the stable request ID and the exact body sent,
//     so a retry after a lost response is the same request, never a second confirmation.
//   * `late` — progress of sending one retained capture as late evidence: its stable request
//     ID, per-photo upload IDs and, once it exists, the server's receipt.
import type {
  ConfirmSubstitutionRequest,
  LateEvidenceRead,
  SubstitutionRequestRead,
  SubstitutionRole,
  SubstitutionSealCondition,
} from '@shared/lib/types/driver-substitution'

const DB_NAME = 'fp_substitution_store'
const DB_VERSION = 1
const CAPTURES = 'captures'
const LATE = 'late'
const QUOTA_ERROR_NAME = 'QuotaExceededError'

export interface CapturePhoto {
  /** Local id, stable for the photo's life. */
  id: string
  dataUrl: string
  capturedAt: string
  /** Sent as the upload's client_request_id on every attempt, so a lost response never duplicates it. */
  uploadRequestId: string
  /** Persisted the moment the upload lands, so a crash never re-uploads. */
  uploadedArtifactId: string | null
}

export interface CaptureSealCheck {
  vehicleId: string
  condition: SubstitutionSealCondition | null
  /** As typed; normalised when the body is built. */
  sealNumber: string
  notApplicableReason: string
  photos: CapturePhoto[]
}

export interface CapturePosition {
  latitude: number
  longitude: number
  accuracyMetres: number | null
}

/**
 * 'draft' — being filled in. 'sending' — the driver pressed confirm: the body is fixed and is
 * resent unchanged until the server answers. 'saved' — the server accepted it (completed or
 * still waiting on the other driver/dispatch). 'retained' — the arrangement changed under it
 * (cancelled/replaced); kept for review, never sent against another request.
 */
export type CaptureStatus = 'draft' | 'sending' | 'saved' | 'retained'

export interface SubstitutionCapture {
  /** `${actorId}:${requestId}` — one capture per driver per arrangement. */
  key: string
  actorId: string
  tripId: string
  requestId: string
  role: SubstitutionRole
  status: CaptureStatus
  /** The arrangement version this declaration was made against. */
  expectedVersion: number
  /** The confirmation's client_request_id. Replaced only by a new intentional submit. */
  clientRequestId: string
  /** Exactly what was (or is being) sent. null while still a draft. */
  submittedBody: ConfirmSubstitutionRequest | null
  confirmedVehicleIds: string[]
  sealChecks: CaptureSealCheck[]
  discrepancyNote: string
  /** When the driver confirmed, on this device. Set once per intentional submit. */
  capturedAt: string | null
  /** null means the phone could not give a position — recorded as unavailable, never invented. */
  position: CapturePosition | null
  /** The server's last answer to the submission. */
  result: SubstitutionRequestRead | null
  /** Why a retained/blocked capture is not progressing, in the driver's words. */
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface LateEvidenceProgress {
  /** The retained item this sends: a queue entry id or an exception report id. */
  sourceId: string
  actorId: string
  tripId: string
  custodySequence: number
  /** The late-evidence client_request_id. Fixed for this item for good. */
  clientRequestId: string
  /** Per photo slot: the upload's client_request_id and, once landed, its artifact id. */
  uploads: Record<string, { requestId: string; artifactId: string | null }>
  receipt: LateEvidenceRead | null
  createdAt: string
  updatedAt: string
}

export type SubstitutionStoreFailure = 'unavailable' | 'quota' | 'other'

export class SubstitutionStoreError extends Error {
  readonly failure: SubstitutionStoreFailure

  constructor(failure: SubstitutionStoreFailure, message: string) {
    super(message)
    this.name = 'SubstitutionStoreError'
    this.failure = failure
  }
}

type StoreName = typeof CAPTURES | typeof LATE

let factoryOverride: IDBFactory | null = null
let connection: Promise<IDBDatabase> | null = null

/** Test seam: inject a fake factory; null restores window.indexedDB. Drops the cached connection. */
export function __setSubstitutionIndexedDbForTests(factory: IDBFactory | null): void {
  factoryOverride = factory
  connection = null
}

function currentFactory(): IDBFactory | null {
  if (factoryOverride) return factoryOverride
  return typeof indexedDB === 'undefined' ? null : indexedDB
}

function classify(error: unknown, fallback: string): SubstitutionStoreError {
  if (error instanceof SubstitutionStoreError) return error
  const name = error instanceof DOMException ? error.name : ''
  const message = error instanceof Error ? error.message : fallback
  return new SubstitutionStoreError(name === QUOTA_ERROR_NAME ? 'quota' : 'other', message || fallback)
}

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection
  const factory = currentFactory()
  if (!factory) return Promise.reject(new SubstitutionStoreError('unavailable', 'IndexedDB is not available'))
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(new SubstitutionStoreError('unavailable', err instanceof Error ? err.message : 'IndexedDB open failed'))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CAPTURES)) db.createObjectStore(CAPTURES, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(LATE)) db.createObjectStore(LATE, { keyPath: 'sourceId' })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onclose = () => {
        connection = null
      }
      resolve(db)
    }
    request.onerror = () => {
      reject(new SubstitutionStoreError('unavailable', request.error?.message ?? 'IndexedDB open failed'))
    }
  })
  connection = opening
  // A failed open must not be cached, or one blocked attempt would poison the session.
  opening.catch(() => {
    if (connection === opening) connection = null
  })
  return opening
}

// Resolves once the transaction has COMMITTED, not merely when the request succeeded.
async function transact<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, done: (value: T) => void) => void,
  initial: T,
): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    let result = initial
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(classify(error, 'IndexedDB transaction failed'))
    }
    try {
      const tx = db.transaction(storeName, mode)
      tx.oncomplete = () => {
        if (settled) return
        settled = true
        resolve(result)
      }
      tx.onerror = () => fail(tx.error)
      tx.onabort = () => fail(tx.error)
      work(tx.objectStore(storeName), (value) => {
        result = value
      })
    } catch (err) {
      fail(err)
    }
  })
}

function getOne<T>(storeName: StoreName, key: string): Promise<T | null> {
  return transact<T | null>(storeName, 'readonly', (store, done) => {
    const read = store.get(key)
    read.onsuccess = () => done((read.result as T | undefined) ?? null)
  }, null)
}

function getAll<T>(storeName: StoreName): Promise<T[]> {
  return transact<T[]>(storeName, 'readonly', (store, done) => {
    const read = store.getAll()
    read.onsuccess = () => done(read.result as T[])
  }, [])
}

function putOne<T>(storeName: StoreName, value: T): Promise<void> {
  return transact<void>(storeName, 'readwrite', (store) => {
    store.put(value)
  }, undefined)
}

function deleteOne(storeName: StoreName, key: string): Promise<void> {
  return transact<void>(storeName, 'readwrite', (store) => {
    store.delete(key)
  }, undefined)
}

export function captureKey(actorId: string, requestId: string): string {
  return `${actorId}:${requestId}`
}

export const getCapture = (key: string): Promise<SubstitutionCapture | null> => getOne<SubstitutionCapture>(CAPTURES, key)

export const listCaptures = (): Promise<SubstitutionCapture[]> => getAll<SubstitutionCapture>(CAPTURES)

export function saveCapture(capture: SubstitutionCapture): Promise<void> {
  return putOne(CAPTURES, { ...capture, updatedAt: new Date().toISOString() })
}

/** Only for a capture the server has acknowledged, or the driver's deliberate discard. */
export const removeCapture = (key: string): Promise<void> => deleteOne(CAPTURES, key)

/** Records one landed photo upload in place, so a crash right after never re-uploads it. */
export function recordCapturePhotoUploaded(key: string, photoId: string, artifactId: string): Promise<void> {
  return transact<void>(CAPTURES, 'readwrite', (store) => {
    const read = store.get(key)
    read.onsuccess = () => {
      const current = read.result as SubstitutionCapture | undefined
      if (!current) return
      store.put({
        ...current,
        sealChecks: current.sealChecks.map((check) => ({
          ...check,
          photos: check.photos.map((photo) => (photo.id === photoId ? { ...photo, uploadedArtifactId: artifactId } : photo)),
        })),
        updatedAt: new Date().toISOString(),
      })
    }
  }, undefined)
}

export const getLateProgress = (sourceId: string): Promise<LateEvidenceProgress | null> =>
  getOne<LateEvidenceProgress>(LATE, sourceId)

export const listLateProgress = (): Promise<LateEvidenceProgress[]> => getAll<LateEvidenceProgress>(LATE)

export function saveLateProgress(progress: LateEvidenceProgress): Promise<void> {
  return putOne(LATE, { ...progress, updatedAt: new Date().toISOString() })
}
