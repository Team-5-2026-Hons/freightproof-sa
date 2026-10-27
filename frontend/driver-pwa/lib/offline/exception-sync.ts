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
  | { kind: 'transient'; retryAfterMs: number | null }
  | { kind: 'rejected'; reason: string; photoId: string | null; status: number; attention: RetainedAttention }
  | { kind: 'busy' }
  | { kind: 'not-yours' }

export interface ExceptionSendOptions {
  durable: boolean
  post: (artifactIds: string[]) => Promise<unknown>
  lockHeld?: boolean
  onProgress?: (uploaded: number, total: number) => void
}

const MISSING_BYTES_REASON = 'photo bytes missing'
const MISSING_BYTES_STATUS = 0
const DATA_URL_SEPARATOR = ','
const BASE64_MARKER = ';base64'
const DEFAULT_MIME = 'application/octet-stream'

const held = new Set<string>()
const waiters = new Map<string, Array<() => void>>()

function releaseReportLock(id: string): void {
  const next = waiters.get(id)?.shift()
  if (next) {
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
  if (envelope.status === 'quarantined' || lease === null || envelope.actorId !== lease.actorId) {
    return { kind: 'not-yours' }
  }
  const custodySequence = envelope.body.custody_sequence ?? null
  const memory = volatileIds.get(id) ?? new Map<string, string>()
  volatileIds.set(id, memory)

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
      const attention = failure.kind === 'rejected'
        ? failure.attention
        : retainedAttention(null, 0, 'The photo could not be stored on the server.')
      await markAttention(envelope, durable, attention.reason, item.id, attention)
      return { kind: 'rejected', reason: attention.reason, status: attention.status, attention, photoId: item.id }
    }
    uploaded += 1
    if (durable) {
      try {
        await recordPhotoUploaded(id, item.id, artifact.id)
      } catch (err) {
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
      await markAttention(envelope, durable, failure.reason, null, failure.attention)
      return { ...failure, photoId: null }
    }
  }

  volatileIds.delete(id)
  if (durable) {
    try {
      await removeExceptionEnvelope(id)
    } catch (err) {
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
