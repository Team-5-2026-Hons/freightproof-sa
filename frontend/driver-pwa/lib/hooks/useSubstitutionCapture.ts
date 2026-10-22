'use client'

// One driver's own handover (outgoing) or takeover (incoming) check, captured on
// their own device, persisted before anything is sent, and sent so a retry is provably the
// same request (contract v1, "Driver endpoints" and "Common wire rules").
//
// What this never does: switch custody optimistically, treat a pending answer as a failure,
// reuse a capture against a different request, or present a fresh identity check. The server
// decides completion; this only records and reports what it said.

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type {
  ConfirmSubstitutionRequest,
  ConfirmSubstitutionObservationRequest,
  DriverSubstitutionContextRead,
  SealCheck,
  SubstitutionConfirmationDetail,
  SubstitutionRequestRead,
  SubstitutionRole,
  SubstitutionSealCondition,
  VehicleRef,
} from '@shared/lib/types/driver-substitution'
import type { PhaseType } from '@shared/lib/types/phase'
import {
  confirmDriverSubstitution,
  fetchDriverSubstitutionContext,
  uploadSubstitutionArtifact,
} from '@/lib/api/driver-substitutions'
import { LocationContext } from '@/lib/context/LocationContext'
import { classifyLiveWriteFailure } from '@/lib/offline/live-write-conflict'
import { tryReportLock } from '@/lib/offline/exception-sync'
import {
  captureKey,
  getCapture,
  listCaptures,
  recordCapturePhotoUploaded,
  saveCapture,
  type CapturePhoto,
  type CaptureSealCheck,
  type SubstitutionCapture,
} from '@/lib/offline/substitution-store'
import { captureActorLease, currentActorId, isActorLeaseCurrent } from '@/lib/session/custody-context'
import { substitutionRoleFor } from '@/lib/utils/driver-substitution'
import { isValidSealFormat, normalizeSeal } from '@/lib/utils/seal-format'

// Contract bound for the not-applicable reason and the discrepancy note.
export const SUBSTITUTION_TEXT_MAX_LENGTH = 1000
// Shares the report lock registry so a background retry and an on-screen submit of the same
// capture can never run at once.
const LOCK_PREFIX = 'substitution:'

// ── Pure rules (no I/O) ──────────────────────────────────────────────────────────

/**
 * The vehicles that need a seal check: every trailer, or the horse when there are none
 * (contract v1). Whether the leg is loaded is the server's knowledge, so `not_applicable` is
 * always offered and the server rejects it on a loaded leg.
 */
export function sealApplicableVehicles(vehicles: readonly VehicleRef[]): VehicleRef[] {
  const trailers = vehicles.filter((vehicle) => vehicle.vehicle_type === 'trailer')
  return trailers.length > 0 ? trailers : vehicles.filter((vehicle) => vehicle.vehicle_type === 'horse')
}

/**
 * What a seal check can find, read off the trip's LEDGER position rather than assumed.
 * - `none-yet`: the ledger has not reached departure, so no seal has been applied — a
 *   takeover before activation or during loading finds nothing to read.
 * - `possible`: the departure phase is open; its first step applies the seal, its second
 *   confirms departure, so the seal may or may not be on.
 * - `expected`: the trip has departed; a seal is on every applicable vehicle.
 * - `unknown`: the context carried no position (the server sends one only while the
 *   request is pending), so nothing is assumed either way.
 */
export type SealExpectation = 'none-yet' | 'possible' | 'expected' | 'unknown'

// The seal is applied by the departure phase's `2-capture-seal` step (phase-meta STEP_SLUGS),
// so every phase before departure runs with no seal on the load.
const PHASES_BEFORE_SEAL: readonly PhaseType[] = ['trip_creation', 'activation', 'loading']
const SEAL_APPLYING_PHASE: PhaseType = 'departure'

export function sealExpectation(context: Pick<DriverSubstitutionContextRead, 'current_phase'>): SealExpectation {
  if (context.current_phase === null) return 'unknown'
  if (PHASES_BEFORE_SEAL.includes(context.current_phase)) return 'none-yet'
  return context.current_phase === SEAL_APPLYING_PHASE ? 'possible' : 'expected'
}

/** The recorded reason when the ledger says no seal exists yet; the driver may still edit it. */
export const NO_SEAL_YET_REASON = 'No seal applied yet: the trip has not departed'

function emptySealCheck(vehicleId: string): CaptureSealCheck {
  return { vehicleId, condition: null, sealNumber: '', notApplicableReason: '', photos: [] }
}

// Pre-filled from the ledger, never from trip_type: a loaded trip taken over before departure
// genuinely has no seal, and asking the driver to read one invites an invented number.
function noSealYetCheck(vehicleId: string): CaptureSealCheck {
  return { ...emptySealCheck(vehicleId), condition: 'not_applicable', notApplicableReason: NO_SEAL_YET_REASON }
}

export function newCapture(
  actorId: string,
  context: DriverSubstitutionContextRead,
  role: SubstitutionRole,
): SubstitutionCapture {
  const now = new Date().toISOString()
  return {
    key: captureKey(actorId, context.id),
    actorId,
    tripId: context.trip_id,
    requestId: context.id,
    role,
    status: 'draft',
    expectedVersion: context.version,
    clientRequestId: crypto.randomUUID(),
    submittedBody: null,
    captureFormat: 'observation_v2', locationObservedAt: null, locationUnavailableReason: null,
    confirmedVehicleIds: [],
    sealChecks: sealApplicableVehicles(context.vehicles).map((vehicle) => (
      sealExpectation(context) === 'none-yet' ? noSealYetCheck(vehicle.id) : emptySealCheck(vehicle.id)
    )),
    discrepancyNote: '',
    capturedAt: null,
    position: null,
    result: null,
    note: null,
    createdAt: now,
    updatedAt: now,
  }
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

/** Every reason this capture cannot be confirmed yet, in the driver's words. Empty = ready. */
export function captureProblems(capture: SubstitutionCapture, vehicles: readonly VehicleRef[]): string[] {
  const problems: string[] = []
  const unchecked = vehicles.filter((vehicle) => !capture.confirmedVehicleIds.includes(vehicle.id))
  if (unchecked.length > 0) {
    problems.push(`Confirm every vehicle: ${unchecked.map((vehicle) => vehicle.registration).join(', ')}`)
  }
  for (const check of capture.sealChecks) {
    const registration = vehicles.find((vehicle) => vehicle.id === check.vehicleId)?.registration ?? 'vehicle'
    switch (check.condition) {
      case null:
        problems.push(`Record the seal on ${registration}`)
        break
      case 'intact':
      case 'damaged':
        if (!isValidSealFormat(check.sealNumber)) problems.push(`Seal number on ${registration} must look like AB-1234`)
        if (check.photos.length === 0) problems.push(`Photograph the seal on ${registration}`)
        break
      case 'missing':
        if (check.photos.length === 0) problems.push(`Photograph where the seal should be on ${registration}`)
        break
      case 'not_applicable':
        if (!hasText(check.notApplicableReason)) problems.push(`Say why ${registration} has no seal`)
        else if (check.notApplicableReason.length > SUBSTITUTION_TEXT_MAX_LENGTH) problems.push(`The reason for ${registration} is too long`)
        break
    }
  }
  if (capture.discrepancyNote.length > SUBSTITUTION_TEXT_MAX_LENGTH) problems.push('The note is too long')
  return problems
}

function sealCheckBody(check: CaptureSealCheck, condition: SubstitutionSealCondition): SealCheck {
  const photoIds = check.photos
    .map((photo) => photo.uploadedArtifactId)
    .filter((id): id is string => id !== null)
  return {
    vehicle_id: check.vehicleId,
    condition,
    // Number only where a seal exists to read; normalised exactly as the phase rule expects.
    seal_number: condition === 'intact' || condition === 'damaged' ? normalizeSeal(check.sealNumber) : null,
    photo_artifact_ids: photoIds,
    // Per vehicle, and only for the empty-leg answer — never one note copied onto every vehicle.
    not_applicable_reason: condition === 'not_applicable' ? check.notApplicableReason.trim() : null,
  }
}

/** The wire body, from a capture whose photos are all uploaded. Built from the shared schema. */
function legacyConfirmationBody(capture: SubstitutionCapture): ConfirmSubstitutionRequest {
  if (capture.capturedAt === null) throw new Error('A confirmation needs its capture time.')
  const note = capture.discrepancyNote.trim()
  return {
    client_request_id: capture.clientRequestId,
    expected_version: capture.expectedVersion,
    captured_at: capture.capturedAt,
    // Null together when the phone had no position: absence is recorded, never invented.
    latitude: capture.position?.latitude ?? null,
    longitude: capture.position?.longitude ?? null,
    accuracy_metres: capture.position !== null ? capture.position.accuracyMetres : null,
    confirmed_vehicle_ids: [...capture.confirmedVehicleIds],
    seal_checks: capture.sealChecks.flatMap((check) => (check.condition === null ? [] : [sealCheckBody(check, check.condition)])),
    discrepancy_note: note === '' ? null : note,
  }
}

export function confirmationBody(capture: SubstitutionCapture): ConfirmSubstitutionObservationRequest {
  return { ...legacyConfirmationBody(capture), capture_format: 'observation_v2',
    location_observed_at: capture.locationObservedAt ?? null,
    location_unavailable_reason: capture.locationUnavailableReason ?? null }
}

/** This driver's submitted declaration, if the server already holds one. */
export function ownConfirmation(
  context: DriverSubstitutionContextRead,
  actorId: string,
): SubstitutionConfirmationDetail | null {
  return context.confirmations.find((confirmation) => confirmation.driver_id === actorId) ?? null
}

// ── Sending (module scope: shared by the screen and the background retry) ────────

export type CaptureSendOutcome =
  /** 200: saved. `result.state` says whether the transfer completed. */
  | { kind: 'saved'; result: SubstitutionRequestRead }
  /** No answer (offline, 5xx, 429). Kept as sent; the same request is retried later. */
  | { kind: 'waiting' }
  /** The arrangement changed under the capture; kept, and the driver decides again. */
  | { kind: 'version-changed'; note: string }
  /** Cancelled, replaced or already completed; kept for review, never resent. */
  | { kind: 'not-pending'; note: string }
  /** Refused for its content; back to draft with the server's reason. */
  | { kind: 'rejected'; note: string }
  /** Another send of this capture is running, or it is not this driver's. */
  | { kind: 'busy' }

const VERSION_CHANGED_NOTE = 'Dispatch changed this arrangement after you started your check. Your check is kept — review the details and confirm again.'
const NOT_PENDING_NOTE = 'This arrangement is no longer open (cancelled, replaced or already complete). Your check is kept on this phone and was not used.'
const KEY_REUSED_NOTE = 'The server already holds a different version of this check. Yours is kept — review it and confirm again.'
const PHOTO_REFUSED_NOTE = 'A photo was not accepted. Retake it and confirm again.'

async function backToDraft(capture: SubstitutionCapture, note: string): Promise<void> {
  // The sent body is dropped so the next press is a NEW intentional action with its own key;
  // nothing the driver captured is lost.
  await saveCapture({ ...capture, status: 'draft', submittedBody: null, note })
}

async function runSend(key: string): Promise<CaptureSendOutcome> {
  const lease = captureActorLease()
  const capture = await getCapture(key)
  if (lease === null || !isActorLeaseCurrent(lease) || capture === null || capture.status !== 'sending' || capture.actorId !== lease.actorId) return { kind: 'busy' }

  // Photos first, each with its own stable request id and its artifact id saved on landing.
  const working: SubstitutionCapture = { ...capture, sealChecks: capture.sealChecks.map((check) => ({ ...check, photos: [...check.photos] })) }
  for (const check of working.sealChecks) {
    for (const [index, photo] of check.photos.entries()) {
      if (photo.uploadedArtifactId !== null) continue
      if (!isActorLeaseCurrent(lease)) return { kind: 'waiting' }
      try {
        const artifact = await uploadSubstitutionArtifact(working.tripId, working.requestId, working.role, {
          artifactType: 'photo', dataUrl: photo.dataUrl, capturedAt: photo.capturedAt, clientRequestId: photo.uploadRequestId,
        })
        check.photos[index] = { ...photo, uploadedArtifactId: artifact.id }
        await recordCapturePhotoUploaded(key, photo.id, artifact.id)
      } catch (err: unknown) {
        const failure = classifyLiveWriteFailure(err)
        if (failure.kind === 'transient') return { kind: 'waiting' }
        if (failure.kind === 'retain' && failure.attention.code === 'SUBSTITUTION_NOT_PENDING') {
          await saveCapture({ ...working, status: 'retained', note: NOT_PENDING_NOTE })
          return { kind: 'not-pending', note: NOT_PENDING_NOTE }
        }
        await backToDraft(working, PHOTO_REFUSED_NOTE)
        return { kind: 'rejected', note: PHOTO_REFUSED_NOTE }
      }
    }
  }

  // The body is fixed once and saved BEFORE the POST: every retry resends exactly it.
  if (!isActorLeaseCurrent(lease)) return { kind: 'waiting' }
  const body = working.submittedBody ?? (working.captureFormat === 'observation_v2' ? confirmationBody(working) : legacyConfirmationBody(working))
  if (working.submittedBody === null) {
    working.submittedBody = body
    await saveCapture(working)
  }

  try {
    if (!isActorLeaseCurrent(lease)) return { kind: 'waiting' }
    const result = await confirmDriverSubstitution(working.tripId, working.requestId, body)
    // Bytes are on the server now; drop the local copies, keep the ids and the answer.
    await saveCapture({
      ...working,
      status: 'saved',
      result,
      note: null,
      sealChecks: working.sealChecks.map((check) => ({ ...check, photos: check.photos.map((photo) => ({ ...photo, dataUrl: '' })) })),
    })
    return { kind: 'saved', result }
  } catch (err: unknown) {
    const failure = classifyLiveWriteFailure(err)
    if (failure.kind === 'transient') return { kind: 'waiting' }
    const code = failure.kind === 'retain' ? failure.attention.code : null
    if (code === 'SUBSTITUTION_VERSION_CHANGED') {
      await backToDraft(working, VERSION_CHANGED_NOTE)
      return { kind: 'version-changed', note: VERSION_CHANGED_NOTE }
    }
    if (code === 'SUBSTITUTION_NOT_PENDING' || code === 'TRIP_HANDED_OVER') {
      await saveCapture({ ...working, status: 'retained', note: NOT_PENDING_NOTE })
      return { kind: 'not-pending', note: NOT_PENDING_NOTE }
    }
    if (code === 'IDEMPOTENCY_KEY_REUSED') {
      await backToDraft(working, KEY_REUSED_NOTE)
      return { kind: 'rejected', note: KEY_REUSED_NOTE }
    }
    const note = failure.kind === 'retain' ? failure.attention.reason : 'The server did not accept this check.'
    await backToDraft(working, note)
    return { kind: 'rejected', note }
  }
}

/** Sends (or resends) one capture that is in 'sending'. Safe to call from anywhere, any time. */
export async function sendSubstitutionCapture(key: string): Promise<CaptureSendOutcome> {
  const release = tryReportLock(`${LOCK_PREFIX}${key}`)
  if (!release) return { kind: 'busy' }
  try {
    return await runSend(key)
  } catch (err: unknown) {
    // A storage failure mid-send: the capture is still on disk as it was last saved.
    console.warn('useSubstitutionCapture: send interrupted; will retry', err)
    return { kind: 'waiting' }
  } finally {
    release()
  }
}

/**
 * Background retry for confirmations that were pressed but never answered (offline, app
 * killed). Only this driver's, only ones still 'sending'. Called from the substitution
 * refresh, so it runs on foreground, reconnect and the visible-app interval.
 */
export async function flushSubstitutionCaptures(): Promise<boolean> {
  const lease = captureActorLease()
  const actorId = currentActorId()
  if (actorId === null) return false
  let anySaved = false
  try {
    for (const capture of await listCaptures()) {
      if (lease === null || !isActorLeaseCurrent(lease)) break
      if (capture.status !== 'sending' || capture.actorId !== actorId) continue
      const outcome = await sendSubstitutionCapture(capture.key)
      if (outcome.kind === 'saved') anySaved = true
    }
  } catch (err: unknown) {
    console.warn('useSubstitutionCapture: could not list handover checks to retry', err)
  }
  return anySaved
}

// ── The hook ─────────────────────────────────────────────────────────────────────

export interface SubstitutionCaptureState {
  context: DriverSubstitutionContextRead | null
  capture: SubstitutionCapture | null
  role: SubstitutionRole | null
  /** This driver's confirmation the server already holds — rendered read-only. */
  submitted: SubstitutionConfirmationDetail | null
  problems: string[]
  isLoading: boolean
  loadError: string | null
  /** True while a send is running on this screen. */
  isSending: boolean
  /** The capture could not be stored on this phone, so it must not be sent. */
  storageError: boolean
  update: (patch: Partial<Pick<SubstitutionCapture, 'confirmedVehicleIds' | 'discrepancyNote'>>) => void
  updateSealCheck: (vehicleId: string, patch: Partial<Omit<CaptureSealCheck, 'vehicleId' | 'photos'>>) => void
  addPhoto: (vehicleId: string, dataUrl: string) => void
  removePhoto: (vehicleId: string, photoId: string) => void
  /** The driver's intentional confirm press. */
  submit: () => Promise<CaptureSendOutcome | null>
  /** Resend the pending request unchanged. */
  retry: () => Promise<CaptureSendOutcome | null>
  refetch: () => Promise<void>
}

const LOAD_ERROR = 'Could not load this handover. Check your connection and try again.'
const NOT_NAMED_ERROR = 'This handover does not name you as one of its drivers.'

export function useSubstitutionCapture(tripId: string, requestId: string, actorId: string | null): SubstitutionCaptureState {
  const location = useContext(LocationContext)
  const [context, setContext] = useState<DriverSubstitutionContextRead | null>(null)
  const [capture, setCapture] = useState<SubstitutionCapture | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const captureRef = useRef<SubstitutionCapture | null>(null)
  captureRef.current = capture

  const role = context !== null && actorId !== null ? substitutionRoleFor(context, actorId) : null
  const submitted = context !== null && actorId !== null ? ownConfirmation(context, actorId) : null

  // Persist every edit before it can be sent. A failed write is surfaced, not swallowed: the
  // contract requires the draft and its request id to be stored before upload/submit.
  const persist = useCallback(async (next: SubstitutionCapture) => {
    setCapture(next)
    try {
      await saveCapture(next)
      setStorageError(false)
    } catch (err: unknown) {
      console.error('useSubstitutionCapture: could not store the handover check', err)
      setStorageError(true)
    }
  }, [])

  const refetch = useCallback(async () => {
    const lease = captureActorLease()
    setLoadError(null)
    try {
      const loaded = await fetchDriverSubstitutionContext(tripId, requestId)
      if (lease !== null && isActorLeaseCurrent(lease)) setContext(loaded)
    } catch (err: unknown) {
      console.error('useSubstitutionCapture: could not load the handover context', err)
      setLoadError(LOAD_ERROR)
    }
  }, [tripId, requestId])

  // Load the server's arrangement, then this driver's local capture for it.
  useEffect(() => {
    if (actorId === null) return
    let live = true
    void (async () => {
      setIsLoading(true)
      let loaded: DriverSubstitutionContextRead | null = null
      try {
        loaded = await fetchDriverSubstitutionContext(tripId, requestId)
      } catch (err: unknown) {
        console.error('useSubstitutionCapture: could not load the handover context', err)
        if (live) setLoadError(LOAD_ERROR)
      }
      let stored: SubstitutionCapture | null = null
      try {
        stored = await getCapture(captureKey(actorId, requestId))
      } catch (err: unknown) {
        console.error('useSubstitutionCapture: could not read the stored handover check', err)
        if (live) setStorageError(true)
      }
      if (!live) return
      setContext(loaded)
      if (loaded !== null) {
        const loadedRole = substitutionRoleFor(loaded, actorId)
        if (loadedRole === null) setLoadError(NOT_NAMED_ERROR)
        else if (loaded.request_format === 'immediate_v2' && loadedRole === 'outgoing') setCapture(null)
        else if (stored === null) setCapture(newCapture(actorId, loaded, loadedRole))
        else if (stored.status === 'sending' && ownConfirmation(loaded, actorId) !== null) {
          // The response was lost but the server has it: the original saved result stands.
          const saved: SubstitutionCapture = { ...stored, status: 'saved', result: loaded, note: null }
          setCapture(saved)
          void saveCapture(saved).catch((err: unknown) => console.warn('useSubstitutionCapture: could not record the saved check', err))
        } else setCapture(stored)
      } else if (stored !== null) {
        setCapture(stored)
      }
      setIsLoading(false)
    })()
    return () => { live = false }
  }, [tripId, requestId, actorId])

  // Edits are allowed only on a draft. A sent capture is fixed until the server answers.
  const edit = useCallback((change: (current: SubstitutionCapture) => SubstitutionCapture) => {
    const current = captureRef.current
    if (current === null || current.status !== 'draft') return
    void persist(change(current))
  }, [persist])

  const update = useCallback<SubstitutionCaptureState['update']>((patch) => {
    edit((current) => ({ ...current, ...patch }))
  }, [edit])

  const updateSealCheck = useCallback<SubstitutionCaptureState['updateSealCheck']>((vehicleId, patch) => {
    edit((current) => ({
      ...current,
      sealChecks: current.sealChecks.map((check) => (check.vehicleId === vehicleId ? { ...check, ...patch } : check)),
    }))
  }, [edit])

  const addPhoto = useCallback<SubstitutionCaptureState['addPhoto']>((vehicleId, dataUrl) => {
    const photo: CapturePhoto = {
      id: crypto.randomUUID(), dataUrl, capturedAt: new Date().toISOString(),
      uploadRequestId: crypto.randomUUID(), uploadedArtifactId: null,
    }
    edit((current) => ({
      ...current,
      sealChecks: current.sealChecks.map((check) => (check.vehicleId === vehicleId ? { ...check, photos: [...check.photos, photo] } : check)),
    }))
  }, [edit])

  const removePhoto = useCallback<SubstitutionCaptureState['removePhoto']>((vehicleId, photoId) => {
    edit((current) => ({
      ...current,
      sealChecks: current.sealChecks.map((check) => (check.vehicleId === vehicleId
        ? { ...check, photos: check.photos.filter((photo) => photo.id !== photoId) }
        : check)),
    }))
  }, [edit])

  const runAndReload = useCallback(async (key: string): Promise<CaptureSendOutcome> => {
    const lease = captureActorLease()
    setIsSending(true)
    try {
      const outcome = await sendSubstitutionCapture(key)
      // A receipt may finish safely for its original actor; it must not launch a
      // context read or replace another account's UI after that account changes.
      if (lease === null || !isActorLeaseCurrent(lease)) return outcome
      const reloaded = await getCapture(key).catch(() => null)
      if (!isActorLeaseCurrent(lease)) return outcome
      if (reloaded !== null) setCapture(reloaded)
      // Every terminal answer changes what the server holds: read it again, never assume.
      if (outcome.kind !== 'waiting' && outcome.kind !== 'busy') await refetch()
      return outcome
    } finally {
      setIsSending(false)
    }
  }, [refetch])

  const submit = useCallback(async (): Promise<CaptureSendOutcome | null> => {
    const lease = captureActorLease()
    const current = captureRef.current
    if (lease === null || current === null || current.actorId !== lease.actorId || current.status !== 'draft' || context === null) return null
    if (context.state !== 'pending' || (context.request_format === 'immediate_v2' && current.role === 'outgoing')) return null
    if (captureProblems(current, context.vehicles).length > 0) return null
    // The moment of the declaration, taken on this device. Position is best effort: a phone
    // that cannot give one records "unavailable" (null), it never blocks or invents a fix.
    const capturedAt = new Date().toISOString()
    const observation = location !== null ? await location.captureObservation() : { position: null, unavailableReason: 'unknown' as const }
    const fix = observation.position
    if (!isActorLeaseCurrent(lease) || captureRef.current !== current) return null
    const sending: SubstitutionCapture = {
      ...current,
      status: 'sending',
      // A NEW intentional action: its own key, made against the version on screen now.
      clientRequestId: crypto.randomUUID(),
      expectedVersion: context.version,
      submittedBody: null,
      capturedAt,
      captureFormat: 'observation_v2', locationObservedAt: fix?.capturedAt ?? null,
      locationUnavailableReason: observation.unavailableReason,
      position: fix !== null ? { latitude: fix.lat, longitude: fix.lng, accuracyMetres: fix.accuracyM } : null,
      note: null,
    }
    try {
      await saveCapture(sending)
    } catch (err: unknown) {
      // Not stored means a retry could not be proven the same request: do not send.
      console.error('useSubstitutionCapture: could not store the confirmation before sending', err)
      setStorageError(true)
      return null
    }
    setCapture(sending)
    if (!isActorLeaseCurrent(lease)) return { kind: 'waiting' }
    return runAndReload(sending.key)
  }, [context, location, runAndReload])

  const retry = useCallback(async (): Promise<CaptureSendOutcome | null> => {
    const current = captureRef.current
    if (current === null || current.status !== 'sending') return null
    return runAndReload(current.key)
  }, [runAndReload])

  const problems = capture !== null && context !== null ? captureProblems(capture, context.vehicles) : []

  return {
    context, capture, role, submitted, problems, isLoading, loadError, isSending, storageError,
    update, updateSealCheck, addPhoto, removePhoto, submit, retry, refetch,
  }
}
