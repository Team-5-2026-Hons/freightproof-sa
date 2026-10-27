// Durable queue for exception reports, in native IndexedDB. localStorage can't hold
// photo bytes (~5MB cap, base64 bloat), and a report with photos must survive a dead
// battery or a killed tab, so reports and their photo Blobs live here instead.
import type { RaiseExceptionBody } from '@/lib/api/exceptions'
import type { RetainedAttention } from './live-write-conflict'

const DB_NAME = 'fp_exception_store'
const DB_VERSION = 1
const STORE_NAME = 'reports'
const KEY_PATH = 'clientReportId'
const QUOTA_ERROR_NAME = 'QuotaExceededError'

export type ExceptionReportStatus = 'pending' | 'needs-attention' | 'quarantined'

export type ExceptionReportBody = Omit<RaiseExceptionBody, 'supporting_artifact_id' | 'supporting_artifact_ids'>

export interface ExceptionPhotoRecord {
  id: string
  blob: Blob | null
  capturedAt: string
  uploadedArtifactId: string | null
}

export interface ExceptionEnvelope {
  clientReportId: string
  tripId: string
  body: ExceptionReportBody
  photos: ExceptionPhotoRecord[]
  status: ExceptionReportStatus
  attentionReason: string | null
  attentionPhotoId: string | null
  actorId?: string | null
  attention?: RetainedAttention | null
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
  opening.catch(() => {
    if (connection === opening) connection = null
  })
  return opening
}

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
  return [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

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
  attention: RetainedAttention | null = null,
): Promise<void> {
  return update(clientReportId, (current) => ({
    ...current,
    status: 'needs-attention',
    attentionReason: reason,
    attentionPhotoId: photoId,
    attention,
  }))
}

/**
 * Migration: envelopes written before the capturing account was recorded. One
 * read-modify-write transaction, so the envelope is never absent between states, and a rerun
 * finds nothing left to do. Returns how many were quarantined.
 */
export function quarantineUnattributedEnvelopes(): Promise<number> {
  return transact<number>(
    'readwrite',
    (store, done) => {
      const read = store.getAll()
      read.onsuccess = () => {
        let count = 0
        for (const envelope of read.result as ExceptionEnvelope[]) {
          if (envelope.actorId !== undefined || envelope.status === 'quarantined') continue
          store.put({ ...envelope, status: 'quarantined', actorId: null, updatedAt: new Date().toISOString() })
          count += 1
        }
        done(count)
      }
    },
    0,
  )
}

/** The driver's "Try again". A quarantined report is never released this way. */
export function resetExceptionToPending(clientReportId: string): Promise<void> {
  return update(clientReportId, (current) => (current.status === 'quarantined' ? null : {
    ...current,
    status: 'pending',
    attentionReason: null,
    attentionPhotoId: null,
    attention: null,
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
