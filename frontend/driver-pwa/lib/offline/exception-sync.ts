// frontend/driver-pwa/lib/offline/exception-sync.ts
// The one place that uploads an exception report's photos and posts the report. Photo
// uploads and the report POST are separate requests, so every step is ordered to be safe
// to repeat: an artifact id is persisted the moment it exists (a crash never re-uploads),
// the report is only posted with the COMPLETE id list (never a reduced set), and the
// report's clientReportId never changes, so a lost POST response replays idempotently.
import { ApiError } from '@/lib/api/client'
import { uploadArtifact } from '@/lib/api/artifacts'
import {
  markExceptionNeedsAttention,
  recordPhotoUploaded,
  removeExceptionEnvelope,
  type ExceptionEnvelope,
} from './exception-store'

export type ExceptionSendOutcome =
  | { kind: 'acknowledged' }
  /** Network/5xx/429/unknown: everything kept, retry later. */
  | { kind: 'transient'; retryAfterMs: number | null }
  /** Terminal 4xx (including 409): needs attention, nothing discarded. */
  | { kind: 'rejected'; reason: string; photoId: string | null; status: number }
  /** Another caller already holds this report. */
  | { kind: 'busy' }

export interface ExceptionSendOptions {
  /** False when the store refused the envelope: progress is kept in memory only. */
  durable: boolean
  post: (artifactIds: string[]) => Promise<unknown>
  /** True when the caller already holds this report's lock (see tryReportLock). */
  lockHeld?: boolean
  onProgress?: (uploaded: number, total: number) => void
}

const HTTP_CLIENT_ERROR_MIN = 400
const HTTP_SERVER_ERROR_MIN = 500
const HTTP_TOO_MANY_REQUESTS = 429
// Statuses that describe the session or the request timing, not the report: an expired
// sign-in or a dead-zone timeout must wait, not park a good report as "not accepted".
const HTTP_UNAUTHORIZED = 401
const HTTP_REQUEST_TIMEOUT = 408
// A 429 without Retry-After must still schedule a retry: a null delay would leave the
// report waiting for an unrelated flush trigger. Mirrors useOfflineQueue's own default.
export const DEFAULT_RATE_LIMIT_RETRY_MS = 60_000
const MISSING_BYTES_REASON = 'photo bytes missing'
const MISSING_BYTES_STATUS = 0
const DATA_URL_SEPARATOR = ','
const BASE64_MARKER = ';base64'
const DEFAULT_MIME = 'application/octet-stream'

// A report must never be saved or sent by two callers at once. Page submit, background
// flush and a re-enqueue all share this lock: without it an older send could acknowledge
// and delete a newer saved draft (new photos included), or upload one photo twice.
// Module-level because every caller shares it; waiters are served in arrival order.
const held = new Set<string>()
const waiters = new Map<string, Array<() => void>>()

function releaseReportLock(id: string): void {
  const next = waiters.get(id)?.shift()
  if (next) {
    // Hand over without ever clearing `held`, so a third caller cannot slip in between.
    next()
    return
  }
  waiters.delete(id)
  held.delete(id)
}

/** Non-waiting: returns a release function, or null when someone else holds the report. */
export function tryReportLock(id: string): (() => void) | null {
  if (held.has(id)) return null
  held.add(id)
  return () => releaseReportLock(id)
}

/** Waiting: resolves with a release function once earlier holders have finished. */
export function waitReportLock(id: string): Promise<() => void> {
  const release = tryReportLock(id)
  if (release) return Promise.resolve(release)
  return new Promise((resolve) => {
    const queue = waiters.get(id) ?? []
    queue.push(() => resolve(() => releaseReportLock(id)))
    waiters.set(id, queue)
  })
}

// Artifact ids uploaded this session, per report and photo. Kept for EVERY report, durable
// or not: if recording an id in IndexedDB fails, the id is still known here, so the next
// attempt resumes instead of uploading the photo again. Lost on reload by design; cleared
// when the server acknowledges the report.
const volatileIds = new Map<string, Map<string, string>>()

export function __resetExceptionSyncForTests(): void {
  held.clear()
  waiters.clear()
  volatileIds.clear()
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read photo'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read photo'))
    reader.readAsDataURL(blob)
  })
}

// Synchronous (atob, no fetch) so the one-shot localStorage migration needs no network
// stack and cannot be failed by a service worker intercepting data: URLs.
export function dataUrlToBlob(dataUrl: string): Blob {
  const separator = dataUrl.indexOf(DATA_URL_SEPARATOR)
  if (!dataUrl.startsWith('data:') || separator === -1) throw new Error('Malformed data URL')
  const header = dataUrl.slice('data:'.length, separator)
  const payload = dataUrl.slice(separator + 1)
  const mime = header.replace(BASE64_MARKER, '') || DEFAULT_MIME
  const binary = header.endsWith(BASE64_MARKER) ? atob(payload) : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

type Failure =
  | { kind: 'transient'; retryAfterMs: number | null }
  | { kind: 'rejected'; reason: string; status: number }

// Only a definite client-side refusal is terminal. 429 and anything unknown are retried:
// treating an unrecognised failure as terminal could strand a valid report.
function classify(error: unknown): Failure {
  if (error instanceof ApiError) {
    if (error.status === HTTP_TOO_MANY_REQUESTS) {
      return { kind: 'transient', retryAfterMs: error.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS }
    }
    if (error.status === HTTP_UNAUTHORIZED || error.status === HTTP_REQUEST_TIMEOUT) {
      return { kind: 'transient', retryAfterMs: null }
    }
    if (error.status >= HTTP_CLIENT_ERROR_MIN && error.status < HTTP_SERVER_ERROR_MIN) {
      return { kind: 'rejected', reason: error.message, status: error.status }
    }
  }
  return { kind: 'transient', retryAfterMs: null }
}

async function markAttention(envelope: ExceptionEnvelope, durable: boolean, reason: string, photoId: string | null) {
  if (!durable) return
  try {
    await markExceptionNeedsAttention(envelope.clientReportId, reason, photoId)
  } catch (err) {
    console.warn('Could not mark exception report as needing attention', err)
  }
}

async function run(envelope: ExceptionEnvelope, options: ExceptionSendOptions): Promise<ExceptionSendOutcome> {
  const { durable, post, onProgress } = options
  const id = envelope.clientReportId
  const memory = volatileIds.get(id) ?? new Map<string, string>()
  volatileIds.set(id, memory)

  // Working copy: ids already known from the envelope or from this session's memory.
  const ids = envelope.photos.map((p) => p.uploadedArtifactId ?? memory.get(p.id) ?? null)
  let uploaded = ids.filter((v) => v !== null).length

  for (let i = 0; i < envelope.photos.length; i += 1) {
    if (ids[i] !== null) continue
    const item = envelope.photos[i]
    if (item.blob === null) {
      await markAttention(envelope, durable, MISSING_BYTES_REASON, item.id)
      return { kind: 'rejected', reason: MISSING_BYTES_REASON, photoId: item.id, status: MISSING_BYTES_STATUS }
    }
    let artifact: Awaited<ReturnType<typeof uploadArtifact>>
    try {
      artifact = await uploadArtifact({
        tripId: envelope.tripId,
        artifactType: 'photo',
        dataUrl: await blobToDataUrl(item.blob),
        capturedAt: item.capturedAt,
      })
      ids[i] = artifact.id
      memory.set(item.id, artifact.id)
    } catch (err) {
      const failure = classify(err)
      if (failure.kind === 'transient') return failure
      await markAttention(envelope, durable, failure.reason, item.id)
      return { ...failure, photoId: item.id }
    }
    uploaded += 1
    // Persist BEFORE the next upload: this is what makes a crash here cost nothing.
    if (durable) {
      try {
        await recordPhotoUploaded(id, item.id, artifact.id)
      } catch (err) {
        // The id stays in `memory` (kept across attempts), so a retry will not re-upload.
        console.warn('Could not persist uploaded photo id; continuing in memory', err)
      }
    }
    onProgress?.(uploaded, envelope.photos.length)
  }

  try {
    await post(ids.filter((value): value is string => value !== null))
  } catch (err) {
    const failure = classify(err)
    if (failure.kind === 'transient') return failure
    // 409 included: a conflicting report is for the driver to see, never auto-discarded.
    await markAttention(envelope, durable, failure.reason, null)
    return { ...failure, photoId: null }
  }

  volatileIds.delete(id)
  if (durable) {
    try {
      await removeExceptionEnvelope(id)
    } catch (err) {
      // Safe to leave: replay by client_report_id returns the original exception.
      console.warn('Could not remove acknowledged exception report', err)
    }
  }
  return { kind: 'acknowledged' }
}

export async function sendExceptionReport(
  envelope: ExceptionEnvelope,
  options: ExceptionSendOptions,
): Promise<ExceptionSendOutcome> {
  if (options.lockHeld) return run(envelope, options)
  const release = tryReportLock(envelope.clientReportId)
  if (!release) return { kind: 'busy' }
  try {
    return await run(envelope, options)
  } finally {
    release()
  }
}
