// frontend/driver-pwa/lib/offline/exception-store.ts
// Durable queue for exception reports, in native IndexedDB. localStorage can't hold
// photo bytes (~5MB cap, base64 bloat), and a report with photos must survive a dead
// battery or a killed tab, so reports and their photo Blobs live here instead.
import type { RaiseExceptionBody } from '@/lib/api/exceptions'

const DB_NAME = 'fp_exception_store'
const DB_VERSION = 1
const STORE_NAME = 'reports'
const KEY_PATH = 'clientReportId'
const QUOTA_ERROR_NAME = 'QuotaExceededError'

export type ExceptionReportStatus = 'pending' | 'needs-attention'

// Everything on RaiseExceptionBody except the photo ids, which live on the photos.
export type ExceptionReportBody = Omit<RaiseExceptionBody, 'supporting_artifact_id' | 'supporting_artifact_ids'>

export interface ExceptionPhotoRecord {
  /** Local id, stable across retakes of other slots. */
  id: string
  /** Null only for legacy photos whose bytes were already uploaded and dropped. */
  blob: Blob | null
  /** ISO time the driver took it. */
  capturedAt: string
  /** Persisted immediately after each upload so a crash never re-uploads. */
  uploadedArtifactId: string | null
}

export interface ExceptionEnvelope {
  /** Store key; one per report draft, never regenerated. */
  clientReportId: string
  tripId: string
  body: ExceptionReportBody
  /** ORDER = display order = order of supporting_artifact_ids. */
  photos: ExceptionPhotoRecord[]
  status: ExceptionReportStatus
  /** Set together with status 'needs-attention'. */
  attentionReason: string | null
  /** Which photo the server rejected, when it was a photo. */
  attentionPhotoId: string | null
  createdAt: string
  updatedAt: string
}

export type ExceptionStoreFailure = 'unavailable' | 'quota' | 'other'

export class ExceptionStoreError extends Error {
  readonly failure: ExceptionStoreFailure

  constructor(failure: ExceptionStoreFailure, message: string) {
    super(message)
    this.name = 'ExceptionStoreError'
    this.failure = failure
  }
}

let factoryOverride: IDBFactory | null = null
let connection: Promise<IDBDatabase> | null = null

/** Test seam: inject a fake factory; null restores window.indexedDB. Drops the cached connection. */
export function __setIndexedDbForTests(factory: IDBFactory | null): void {
  factoryOverride = factory
  connection = null
}

function currentFactory(): IDBFactory | null {
  if (factoryOverride) return factoryOverride
  return typeof indexedDB === 'undefined' ? null : indexedDB
}

function classify(error: unknown, fallback: string): ExceptionStoreError {
  if (error instanceof ExceptionStoreError) return error
  const name = error instanceof DOMException ? error.name : ''
  const message = error instanceof Error ? error.message : fallback
  // Quota is split out because the caller's recovery differs: free space vs. nothing to do.
  return new ExceptionStoreError(name === QUOTA_ERROR_NAME ? 'quota' : 'other', message || fallback)
}

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection
  const factory = currentFactory()
  if (!factory) {
    return Promise.reject(new ExceptionStoreError('unavailable', 'IndexedDB is not available'))
  }
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(new ExceptionStoreError('unavailable', err instanceof Error ? err.message : 'IndexedDB open failed'))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: KEY_PATH })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // A closed/upgraded connection must not be reused; reopen lazily next call.
      db.onclose = () => {
        connection = null
      }
      resolve(db)
    }
    request.onerror = () => {
      reject(new ExceptionStoreError('unavailable', request.error?.message ?? 'IndexedDB open failed'))
    }
  })
  connection = opening
  // A failed open must not be cached, or one blocked attempt would poison the session.
  opening.catch(() => {
    if (connection === opening) connection = null
  })
  return opening
}

// Runs `work` inside ONE transaction and resolves with what it reports once the
// transaction has committed (not merely when the request succeeded).
async function transact<T>(
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
      const tx = db.transaction(STORE_NAME, mode)
      tx.oncomplete = () => {
        if (settled) return
        settled = true
        resolve(result)
      }
      tx.onerror = () => fail(tx.error)
      tx.onabort = () => fail(tx.error)
      work(tx.objectStore(STORE_NAME), (value) => {
        result = value
      })
    } catch (err) {
      fail(err)
    }
  })
}

// Keeps ids already recorded for a photo when the incoming copy hasn't heard of them:
// a stale in-memory envelope must never make us re-upload (and duplicate) a photo.
function mergePhotos(existing: ExceptionPhotoRecord[], incoming: ExceptionPhotoRecord[]): ExceptionPhotoRecord[] {
  const known = new Map(existing.map((p) => [p.id, p.uploadedArtifactId]))
  return incoming.map((p) => {
    const recorded = known.get(p.id)
    return p.uploadedArtifactId === null && recorded ? { ...p, uploadedArtifactId: recorded } : p
  })
}

export function saveExceptionEnvelope(envelope: ExceptionEnvelope): Promise<void> {
  return transact<void>(
    'readwrite',
    (store) => {
      const read = store.get(envelope.clientReportId)
      read.onsuccess = () => {
        const existing = read.result as ExceptionEnvelope | undefined
        store.put(
          existing
            ? {
                ...envelope,
                createdAt: existing.createdAt,
                photos: mergePhotos(existing.photos, envelope.photos),
              }
            : envelope,
        )
      }
    },
    undefined,
  )
}

export function getExceptionEnvelope(clientReportId: string): Promise<ExceptionEnvelope | null> {
  return transact<ExceptionEnvelope | null>(
    'readonly',
    (store, done) => {
      const read = store.get(clientReportId)
      read.onsuccess = () => done((read.result as ExceptionEnvelope | undefined) ?? null)
    },
    null,
  )
}

export async function listExceptionEnvelopes(): Promise<ExceptionEnvelope[]> {
  const all = await transact<ExceptionEnvelope[]>(
    'readonly',
    (store, done) => {
      const read = store.getAll()
      read.onsuccess = () => done(read.result as ExceptionEnvelope[])
    },
    [],
  )
  // ISO strings sort lexically; oldest first so reports flush in the order they happened.
  return [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// Read-modify-write in one transaction so two writers can't overwrite each other's field.
function update(clientReportId: string, change: (current: ExceptionEnvelope) => ExceptionEnvelope | null): Promise<void> {
  return transact<void>(
    'readwrite',
    (store) => {
      const read = store.get(clientReportId)
      read.onsuccess = () => {
        const current = read.result as ExceptionEnvelope | undefined
        if (!current) return
        const next = change(current)
        if (next) store.put({ ...next, updatedAt: new Date().toISOString() })
      }
    },
    undefined,
  )
}

export function recordPhotoUploaded(clientReportId: string, photoId: string, artifactId: string): Promise<void> {
  return update(clientReportId, (current) => {
    if (!current.photos.some((p) => p.id === photoId)) return null
    return {
      ...current,
      photos: current.photos.map((p) => (p.id === photoId ? { ...p, uploadedArtifactId: artifactId } : p)),
    }
  })
}

export function markExceptionNeedsAttention(
  clientReportId: string,
  reason: string,
  photoId: string | null = null,
): Promise<void> {
  return update(clientReportId, (current) => ({
    ...current,
    status: 'needs-attention',
    attentionReason: reason,
    attentionPhotoId: photoId,
  }))
}

/** The driver's "Try again". */
export function resetExceptionToPending(clientReportId: string): Promise<void> {
  return update(clientReportId, (current) => ({
    ...current,
    status: 'pending',
    attentionReason: null,
    attentionPhotoId: null,
  }))
}

export function removeExceptionEnvelope(clientReportId: string): Promise<void> {
  return transact<void>(
    'readwrite',
    (store) => {
      store.delete(clientReportId)
    },
    undefined,
  )
}
