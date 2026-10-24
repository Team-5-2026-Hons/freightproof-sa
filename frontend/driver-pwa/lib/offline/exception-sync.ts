// The one place that uploads an exception report's photos and posts the report. Photo
// uploads and the report POST are separate requests, so every step is ordered to be safe
// to repeat: an artifact id is persisted the moment it exists (a crash never re-uploads),
// the report is only posted with the COMPLETE id list (never a reduced set), and the
// report's clientReportId never changes, so a lost POST response replays idempotently.
import { uploadArtifact } from '@/lib/api/artifacts'
import { captureActorLease, isActorLeaseCurrent } from '@/lib/session/custody-context'
import {
  markExceptionNeedsAttention,
  recordPhotoUploaded,
  removeExceptionEnvelope,
  type ExceptionEnvelope,
} from './exception-store'
import {
  classifyLiveWriteFailure,
  retainedAttention,
  type RetainedAttention,
} from './live-write-conflict'

export type ExceptionSendOutcome =
  | { kind: 'acknowledged' }
  /** Network/5xx/429/unknown: everything kept, retry later. */
  | { kind: 'transient'; retryAfterMs: number | null }
  /** Terminal 4xx (including 409): needs attention, nothing discarded. */
  | { kind: 'rejected'; reason: string; photoId: string | null; status: number; attention: RetainedAttention }
  /** Another caller already holds this report. */
  | { kind: 'busy' }
  /**
   * Captured by a different account than the one signed in now (or by an unknown one).
   * Nothing is sent: replaying A's report with B's token would file it as B's.
   */
  | { kind: 'not-yours' }

export interface ExceptionSendOptions {
  /** False when the store refused the envelope: progress is kept in memory only. */
  durable: boolean
  post: (artifactIds: string[]) => Promise<unknown>
  /** True when the caller already holds this report's lock (see tryReportLock). */
  lockHeld?: boolean
  onProgress?: (uploaded: number, total: number) => void
}

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
  | { kind: 'duplicate' }
  | { kind: 'rejected'; reason: string; status: number; attention: RetainedAttention }

// Only a definite refusal is terminal; 429 and anything unknown are retried, since treating
// an unrecognised failure as terminal could strand a valid report. A proven actor-bound
// duplicate (EVIDENCE_ALREADY_RECORDED) is the one refusal that means "already filed".
function classify(error: unknown): Failure {
  const failure = classifyLiveWriteFailure(error)
  if (failure.kind === 'transient') return failure
  if (failure.kind === 'duplicate') return { kind: 'duplicate' }
  return { kind: 'rejected', reason: failure.attention.reason, status: failure.attention.status, attention: failure.attention }
}

async function markAttention(
  envelope: ExceptionEnvelope,
  durable: boolean,
  reason: string,
  photoId: string | null,
  attention: RetainedAttention | null = null,
) {
  if (!durable) return
  try {
    await markExceptionNeedsAttention(envelope.clientReportId, reason, photoId, attention)
  } catch (err) {
    console.warn('Could not mark exception report as needing attention', err)
  }
}

async function run(envelope: ExceptionEnvelope, options: ExceptionSendOptions): Promise<ExceptionSendOutcome> {
  const { durable, post, onProgress } = options
  const id = envelope.clientReportId
  const lease = captureActorLease()
  // Only the capturing account may send. A legacy envelope (no actor) is quarantined
  // by the migration and never reaches here; this guards a report from a previous sign-in.
  if (envelope.status === 'quarantined' || lease === null || envelope.actorId !== lease.actorId) {
    return { kind: 'not-yours' }
  }
  const custodySequence = envelope.body.custody_sequence ?? null
  const memory = volatileIds.get(id) ?? new Map<string, string>()
  volatileIds.set(id, memory)

  // Working copy: ids already known from the envelope or from this session's memory.
  const ids = envelope.photos.map((p) => p.uploadedArtifactId ?? memory.get(p.id) ?? null)
  let uploaded = ids.filter((v) => v !== null).length

  for (let i = 0; i < envelope.photos.length; i += 1) {
    if (!isActorLeaseCurrent(lease)) return { kind: 'not-yours' }
    if (ids[i] !== null) continue
    const item = envelope.photos[i]
    if (item.blob === null) {
      const attention = retainedAttention(null, MISSING_BYTES_STATUS, MISSING_BYTES_REASON)
      await markAttention(envelope, durable, MISSING_BYTES_REASON, item.id, attention)
      return { kind: 'rejected', reason: MISSING_BYTES_REASON, photoId: item.id, status: MISSING_BYTES_STATUS, attention }
    }
    let artifact: Awaited<ReturnType<typeof uploadArtifact>>
    try {
      const dataUrl = await blobToDataUrl(item.blob)
      if (!isActorLeaseCurrent(lease)) return { kind: 'not-yours' }
      artifact = await uploadArtifact({
        tripId: envelope.tripId,
        artifactType: 'photo',
        dataUrl,
        capturedAt: item.capturedAt,
        custodySequence,
      })
      ids[i] = artifact.id
      memory.set(item.id, artifact.id)
    } catch (err) {
      const failure = classify(err)
      if (failure.kind === 'transient') return failure
      // A photo upload has no actor-bound duplicate of its own: anything but transient is
      // kept for the driver, with the server's coded reason.
      const attention = failure.kind === 'rejected'
        ? failure.attention
        : retainedAttention(null, 0, 'The photo could not be stored on the server.')
      await markAttention(envelope, durable, attention.reason, item.id, attention)
      return { kind: 'rejected', reason: attention.reason, status: attention.status, attention, photoId: item.id }
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
    if (!isActorLeaseCurrent(lease)) return { kind: 'not-yours' }
    await post(ids.filter((value): value is string => value !== null))
  } catch (err) {
    const failure = classify(err)
    if (failure.kind === 'transient') return failure
    if (failure.kind === 'rejected') {
      // 409 included: a conflicting report is for the driver to see, never auto-discarded.
      await markAttention(envelope, durable, failure.reason, null, failure.attention)
      return { ...failure, photoId: null }
    }
    // EVIDENCE_ALREADY_RECORDED for this exact report id: the server holds it, so clear it
    // exactly as an acknowledgement would.
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
