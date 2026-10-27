// "Send as late evidence": a capture the server refused because custody had moved on
// (TRIP_HANDED_OVER / CUSTODY_CONTEXT_CHANGED) goes to the dedicated late-evidence route,
// under the custody period it was CAPTURED in, by the account that captured it. The server
// retains it for dispatcher review; it never completes an old phase or changes custody.
//
// Every step is safe to repeat, as in exception-sync.ts: the late request id is saved before
// any network call, each photo upload has its own stable id and its artifact id is saved the
// moment it lands, and local bytes are cleared only after an explicit server receipt (or an
// actor-bound duplicate acknowledgement).
import type {
  LateEvidencePayload,
  LateEvidenceRead,
  PhaseCompletePayload,
} from '@shared/lib/types/driver-substitution'
import { submitLateEvidence, uploadLateEvidenceArtifact } from '@/lib/api/driver-substitutions'
import { buildPhaseCompleteRequest, type ArtifactIdRequest } from '@/lib/api/phases'
import { checkpointRequestBody } from '@/lib/api/checkpoints'
import { assertActorLease, captureActorLease, currentActorId, isActorLeaseCurrent } from '@/lib/session/custody-context'
import { blobToDataUrl } from './exception-sync'
import {
  getExceptionEnvelope,
  markExceptionNeedsAttention,
  removeExceptionEnvelope,
  type ExceptionEnvelope,
} from './exception-store'
import { classifyLiveWriteFailure, retainedAttention } from './live-write-conflict'
import { isSendableEntry, loadQueue, updateQueue, type SendableQueueEntry } from './queue-storage'
import { getLateProgress, saveLateProgress, type LateEvidenceProgress } from './substitution-store'

/** A retained capture that may be offered as late evidence. */
export type LateEvidenceSource =
  | { origin: 'queue'; entry: SendableQueueEntry }
  | { origin: 'exception'; envelope: ExceptionEnvelope }

export type LateEvidenceOutcome =
  | { kind: 'receipt'; receipt: LateEvidenceRead }
  | { kind: 'already-recorded' }
  | { kind: 'transient' }
  | { kind: 'refused'; reason: string }
  | { kind: 'not-eligible'; reason: string }
  | { kind: 'not-saved' }

const NOT_ELIGIBLE_ACTOR = 'Only the driver who captured this can send it.'
const NOT_ELIGIBLE_PERIOD = 'This capture has no recorded custody period, so it cannot be sent as late evidence.'
const NOT_ELIGIBLE_REASON = 'This capture was not refused for a custody change, so it is not late evidence.'

function sourceId(source: LateEvidenceSource): string {
  return source.origin === 'queue' ? source.entry.id : source.envelope.clientReportId
}

function sourceActor(source: LateEvidenceSource): string | null {
  return (source.origin === 'queue' ? source.entry.actorId : source.envelope.actorId) ?? null
}

function sourceSequence(source: LateEvidenceSource): number | null {
  return source.origin === 'queue'
    ? source.entry.custodySequence ?? null
    : source.envelope.body.custody_sequence ?? null
}

function sourceTrip(source: LateEvidenceSource): string {
  return source.origin === 'queue' ? source.entry.tripId : source.envelope.tripId
}

function sourceLateEligible(source: LateEvidenceSource): boolean {
  const attention = source.origin === 'queue' ? source.entry.attention : source.envelope.attention
  return attention?.lateEligible === true
}

/** Why this source cannot be sent as late evidence by the signed-in driver, or null if it can. */
export function lateEvidenceBlocker(source: LateEvidenceSource): string | null {
  const actorId = sourceActor(source)
  if (actorId === null || actorId !== currentActorId()) return NOT_ELIGIBLE_ACTOR
  if (sourceSequence(source) === null) return NOT_ELIGIBLE_PERIOD
  if (!sourceLateEligible(source)) return NOT_ELIGIBLE_REASON
  return null
}

interface BuiltReport {
  evidence: LateEvidencePayload
  artifactIds: string[]
  capturedAt: string
  originalKey: string | null
}

type UploadSlot = (slot: string, dataUrl: string, capturedAt: string) => Promise<string>

async function buildReport(source: LateEvidenceSource, upload: UploadSlot): Promise<BuiltReport> {
  const artifactIds: string[] = []
  const track = (id: string): string => {
    artifactIds.push(id)
    return id
  }

  if (source.origin === 'exception') {
    const envelope = source.envelope
    const ids: string[] = []
    for (const photo of envelope.photos) {
      if (photo.uploadedArtifactId !== null) {
        ids.push(track(photo.uploadedArtifactId))
      } else if (photo.blob !== null) {
        ids.push(track(await upload(`photo:${photo.id}`, await blobToDataUrl(photo.blob), photo.capturedAt)))
      }
    }
    const { custody_sequence: omittedSequence, ...body } = envelope.body
    void omittedSequence
    return {
      evidence: {
        kind: 'exception',
        payload: { ...body, ...(ids.length > 0 ? { supporting_artifact_ids: ids, supporting_artifact_id: ids[0] } : {}) },
      },
      artifactIds,
      capturedAt: envelope.body.driver_captured_at ?? envelope.createdAt,
      originalKey: envelope.clientReportId,
    }
  }

  const entry = source.entry
  if (entry.kind === 'phase') {
    const resolve = async (request: ArtifactIdRequest): Promise<string> => {
      if (request.readyId !== null) return track(request.readyId)
      return track(await upload(`phase:${request.attribution.role}`, request.dataUrl, request.capturedAt))
    }
    const request = await buildPhaseCompleteRequest({
      tripId: entry.tripId,
      phaseEventId: entry.phaseEventId,
      phaseType: entry.phaseType,
      evidence: entry.evidence,
      idempotencyKey: entry.idempotencyKey,
      position: entry.position ?? null,
      driverCapturedAt: entry.driverCapturedAt,
      acknowledgement: entry.acknowledgement ?? null,
    }, resolve)
    const { custody_sequence: omittedSequence, ...payload } = request
    void omittedSequence
    return {
      evidence: { kind: 'phase', payload: payload as PhaseCompletePayload },
      artifactIds,
      capturedAt: entry.driverCapturedAt,
      originalKey: entry.idempotencyKey,
    }
  }

  if (entry.kind === 'checkpoint') {
    const evidence = entry.evidence
    const cargoPhotoId = track(await upload('checkpoint:cargo', evidence.cargoPhotoDataUrl, evidence.capturedAt))
    const selfieDataUrl = evidence.selfieDataUrl ?? null
    const selfieId = selfieDataUrl !== null
      ? track(await upload('checkpoint:selfie', selfieDataUrl, evidence.capturedAt))
      : null
    return {
      evidence: { kind: 'checkpoint', payload: checkpointRequestBody(evidence, { cargoPhotoId, selfieId }) },
      artifactIds,
      capturedAt: evidence.capturedAt,
      originalKey: evidence.clientReportId ?? null,
    }
  }

  const earliest = entry.pings.reduce<string>(
    (min, ping) => (ping.recorded_at < min ? ping.recorded_at : min),
    entry.pings[0]?.recorded_at ?? entry.enqueuedAt,
  )
  return {
    evidence: { kind: 'location', payload: { pings: entry.pings } },
    artifactIds,
    capturedAt: earliest,
    originalKey: null,
  }
}

async function clearSource(source: LateEvidenceSource): Promise<void> {
  try {
    if (source.origin === 'queue') {
      const id = source.entry.id
      updateQueue((entries) => entries.filter((entry) => entry.id !== id))
    } else {
      await removeExceptionEnvelope(source.envelope.clientReportId)
    }
  } catch (err) {
    console.warn('late-evidence-sync: could not clear a sent capture; it will replay to its receipt', err)
  }
}

async function noteRefusal(source: LateEvidenceSource, reason: string, status: number): Promise<void> {
  const attention = { ...retainedAttention(null, status, reason), lateEligible: true }
  if (source.origin === 'queue') {
    const id = source.entry.id
    updateQueue((entries) => entries.map((entry) => (entry.id === id && isSendableEntry(entry)
      ? { ...entry, attention }
      : entry)))
  } else {
    await markExceptionNeedsAttention(source.envelope.clientReportId, reason, null, attention)
  }
}

/** Re-reads the source from storage so a stale list row is never what gets sent. */
export async function reloadLateEvidenceSource(source: LateEvidenceSource): Promise<LateEvidenceSource | null> {
  if (source.origin === 'queue') {
    const entry = loadQueue().find((candidate) => candidate.id === source.entry.id)
    return entry !== undefined && isSendableEntry(entry) ? { origin: 'queue', entry } : null
  }
  const envelope = await getExceptionEnvelope(source.envelope.clientReportId)
  return envelope !== null ? { origin: 'exception', envelope } : null
}

export async function sendLateEvidence(listed: LateEvidenceSource): Promise<LateEvidenceOutcome> {
  const lease = captureActorLease()
  const source = await reloadLateEvidenceSource(listed)
  if (lease === null || !isActorLeaseCurrent(lease)) return { kind: 'not-eligible', reason: NOT_ELIGIBLE_ACTOR }
  if (source === null) return { kind: 'already-recorded' }
  const blocker = lateEvidenceBlocker(source)
  if (blocker !== null) return { kind: 'not-eligible', reason: blocker }
  const actorId = sourceActor(source) as string
  const custodySequence = sourceSequence(source) as number
  const tripId = sourceTrip(source)
  const id = sourceId(source)

  let progress: LateEvidenceProgress | null
  try {
    progress = await getLateProgress(id)
    if (progress === null) {
      const now = new Date().toISOString()
      progress = {
        sourceId: id, actorId, tripId, custodySequence,
        clientRequestId: crypto.randomUUID(), uploads: {}, receipt: null, createdAt: now, updatedAt: now,
      }
      await saveLateProgress(progress)
    }
  } catch (err) {
    console.warn('late-evidence-sync: could not save the late request id; not sending', err)
    return { kind: 'not-saved' }
  }
  if (progress.receipt !== null) {
    await clearSource(source)
    return { kind: 'receipt', receipt: progress.receipt }
  }

  const working = progress
  const upload: UploadSlot = async (slot, dataUrl, capturedAt) => {
    const known = working.uploads[slot]
    if (known?.artifactId) return known.artifactId
    const requestId = known?.requestId ?? crypto.randomUUID()
    working.uploads[slot] = { requestId, artifactId: null }
    await saveLateProgress(working)
    assertActorLease(lease)
    const artifact = await uploadLateEvidenceArtifact(tripId, custodySequence, {
      artifactType: 'photo', dataUrl, capturedAt, clientRequestId: requestId,
    })
    working.uploads[slot] = { requestId, artifactId: artifact.id }
    try {
      await saveLateProgress(working)
    } catch (err) {
      console.warn('late-evidence-sync: could not record an uploaded artifact id', err)
    }
    return artifact.id
  }

  try {
    const report = await buildReport(source, upload)
    assertActorLease(lease)
    const receipt = await submitLateEvidence(tripId, {
      client_request_id: working.clientRequestId,
      custody_sequence: custodySequence,
      captured_at: report.capturedAt,
      original_idempotency_key: report.originalKey,
      evidence: report.evidence,
      artifact_ids: report.artifactIds,
    })
    working.receipt = receipt
    try {
      await saveLateProgress(working)
    } catch (err) {
      console.warn('late-evidence-sync: could not store the late evidence receipt locally', err)
    }
    await clearSource(source)
    return { kind: 'receipt', receipt }
  } catch (err) {
    const failure = classifyLiveWriteFailure(err)
    if (failure.kind === 'transient') return { kind: 'transient' }
    if (failure.kind === 'duplicate') {
      await clearSource(source)
      return { kind: 'already-recorded' }
    }
    await noteRefusal(source, failure.attention.reason, failure.attention.status)
    return { kind: 'refused', reason: failure.attention.reason }
  }
}
