import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bindActorLease, invalidateActorLease, currentActorId } from '@/lib/session/custody-context'
import { ApiError } from '@/lib/api/client'
import { uploadArtifact } from '@/lib/api/artifacts'
import {
  __setIndexedDbForTests,
  getExceptionEnvelope,
  saveExceptionEnvelope,
  type ExceptionEnvelope,
  type ExceptionPhotoRecord,
} from './exception-store'
import {
  __resetExceptionSyncForTests, sendExceptionReport, tryReportLock, waitReportLock,
} from './exception-sync'
import { DEFAULT_RATE_LIMIT_RETRY_MS } from './live-write-conflict'
import { createFakeIndexedDb } from './testing/fake-indexeddb'

vi.mock('@/lib/api/artifacts', () => ({ uploadArtifact: vi.fn() }))

const upload = vi.mocked(uploadArtifact)

function photo(overrides: Partial<ExceptionPhotoRecord> = {}): ExceptionPhotoRecord {
  return {
    id: crypto.randomUUID(),
    blob: new Blob(['bytes'], { type: 'image/jpeg' }),
    capturedAt: new Date().toISOString(),
    uploadedArtifactId: null,
    ...overrides,
  }
}

function envelope(photos: ExceptionPhotoRecord[] = []): ExceptionEnvelope {
  const now = new Date().toISOString()
  return {
    actorId: currentActorId(),
    clientReportId: crypto.randomUUID(),
    tripId: crypto.randomUUID(),
    body: { exception_type: 'mechanical', description: 'Flat tyre' },
    photos,
    status: 'pending',
    attentionReason: null,
    attentionPhotoId: null,
    createdAt: now,
    updatedAt: now,
  }
}

// Resolves each call with the next id in the list; uploads are identified by order.
function uploadsSucceedWith(...ids: string[]): void {
  for (const id of ids) upload.mockResolvedValueOnce({ id, file_hash: 'h' })
}

beforeEach(() => {
  bindActorLease(crypto.randomUUID(), invalidateActorLease())
  __setIndexedDbForTests(createFakeIndexedDb())
  __resetExceptionSyncForTests()
  upload.mockReset()
})

afterEach(() => {
  __setIndexedDbForTests(null)
})

describe('sendExceptionReport', () => {
  test('test_two_photos_upload_in_order_then_post_complete_id_list', async () => {
    const env = envelope([photo(), photo()])
    await saveExceptionEnvelope(env)
    uploadsSucceedWith('a1', 'a2')
    const post = vi.fn().mockResolvedValue({})

    const outcome = await sendExceptionReport(env, { durable: true, post })

    expect(outcome).toEqual({ kind: 'acknowledged' })
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[0][0].capturedAt).toBe(env.photos[0].capturedAt)
    expect(upload.mock.calls[0][0].tripId).toBe(env.tripId)
    expect(upload.mock.calls[0][0].artifactType).toBe('photo')
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(['a1', 'a2'])
  })

  test('test_artifact_id_persisted_before_next_upload', async () => {
    const env = envelope([photo(), photo()])
    await saveExceptionEnvelope(env)
    uploadsSucceedWith('a1')
    upload.mockRejectedValueOnce(new ApiError(0, 'offline'))
    const post = vi.fn()

    const outcome = await sendExceptionReport(env, { durable: true, post })

    const stored = await getExceptionEnvelope(env.clientReportId)
    expect(outcome.kind).toBe('transient')
    expect(stored?.photos.map((p) => p.uploadedArtifactId)).toEqual(['a1', null])
    expect(post).not.toHaveBeenCalled()
  })

  test('test_restart_after_first_upload_does_not_reupload', async () => {
    const env = envelope([photo(), photo()])
    await saveExceptionEnvelope(env)
    uploadsSucceedWith('a1')
    upload.mockRejectedValueOnce(new ApiError(503, 'down'))
    await sendExceptionReport(env, { durable: true, post: vi.fn() })
    const reread = await getExceptionEnvelope(env.clientReportId)
    upload.mockClear()
    uploadsSucceedWith('a2')
    const post = vi.fn().mockResolvedValue({})

    const outcome = await sendExceptionReport(reread!, { durable: true, post })

    expect(outcome.kind).toBe('acknowledged')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0].capturedAt).toBe(env.photos[1].capturedAt)
    expect(post).toHaveBeenCalledWith(['a1', 'a2'])
  })

  test('test_lost_post_response_keeps_ids_and_resend_uses_same_client_report_id', async () => {
    const env = envelope([photo()])
    await saveExceptionEnvelope(env)
    uploadsSucceedWith('a1')
    const lost = vi.fn().mockRejectedValue(new ApiError(0, 'timeout'))

    const first = await sendExceptionReport(env, { durable: true, post: lost })
    const reread = await getExceptionEnvelope(env.clientReportId)
    const post = vi.fn().mockResolvedValue({})
    const second = await sendExceptionReport(reread!, { durable: true, post })

    expect(first.kind).toBe('transient')
    expect(reread?.clientReportId).toBe(env.clientReportId)
    expect(reread?.photos[0].uploadedArtifactId).toBe('a1')
    expect(second.kind).toBe('acknowledged')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(['a1'])
  })

  test('test_transient_upload_failure_keeps_everything_returns_transient', async () => {
    const env = envelope([photo()])
    await saveExceptionEnvelope(env)
    upload.mockRejectedValueOnce(new Error('network down'))
    const post = vi.fn()

    const outcome = await sendExceptionReport(env, { durable: true, post })

    expect(outcome).toEqual({ kind: 'transient', retryAfterMs: null })
    expect(post).not.toHaveBeenCalled()
    expect(await getExceptionEnvelope(env.clientReportId)).not.toBeNull()
  })

  test('test_terminal_4xx_photo_rejection_returns_rejected_and_marks_needs_attention_without_posting', async () => {
    const env = envelope([photo(), photo()])
    await saveExceptionEnvelope(env)
    uploadsSucceedWith('a1')
    upload.mockRejectedValueOnce(new ApiError(413, 'too large'))
    const post = vi.fn()

    const outcome = await sendExceptionReport(env, { durable: true, post })

    const stored = await getExceptionEnvelope(env.clientReportId)
    expect(outcome).toMatchObject({ kind: 'rejected', photoId: env.photos[1].id, status: 413 })
    expect(post).not.toHaveBeenCalled()
    expect(stored?.status).toBe('needs-attention')
    expect(stored?.attentionPhotoId).toBe(env.photos[1].id)
  })

  test('test_post_409_is_rejected_not_discarded', async () => {
    const env = envelope([])
    await saveExceptionEnvelope(env)
    const post = vi.fn().mockRejectedValue(new ApiError(409, 'conflict'))

    const outcome = await sendExceptionReport(env, { durable: true, post })

    const stored = await getExceptionEnvelope(env.clientReportId)
    expect(outcome).toMatchObject({ kind: 'rejected', status: 409, photoId: null })
    expect(stored?.status).toBe('needs-attention')
  })

  // An expired session or a request timeout says nothing about the report itself, so the
  // report must wait for sign-in / signal instead of being parked as "not accepted".
  test.each([401, 408])('test_post_%i_is_transient_not_needs_attention', async (status) => {
    const env = envelope([])
    await saveExceptionEnvelope(env)
    const post = vi.fn().mockRejectedValue(new ApiError(status, 'nope'))

    const outcome = await sendExceptionReport(env, { durable: true, post })

    expect(outcome.kind).toBe('transient')
    expect((await getExceptionEnvelope(env.clientReportId))?.status).toBe('pending')
  })

  test('test_post_403_stays_terminal', async () => {
    const env = envelope([])
    await saveExceptionEnvelope(env)
    const post = vi.fn().mockRejectedValue(new ApiError(403, 'forbidden'))

    const outcome = await sendExceptionReport(env, { durable: true, post })

    expect(outcome).toMatchObject({ kind: 'rejected', status: 403 })
  })

  test('test_post_never_sends_fewer_photos', async () => {
    const env = envelope([photo(), photo(), photo()])
    await saveExceptionEnvelope(env)
    uploadsSucceedWith('a1')
    upload.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const post = vi.fn()

    await sendExceptionReport(env, { durable: true, post })

    expect(post).not.toHaveBeenCalled()
  })

  test('test_photoless_report_posts_empty_id_list', async () => {
    const env = envelope([])
    await saveExceptionEnvelope(env)
    const post = vi.fn().mockResolvedValue({})

    const outcome = await sendExceptionReport(env, { durable: true, post })

    expect(outcome.kind).toBe('acknowledged')
    expect(upload).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith([])
  })

  test('test_busy_when_locked', async () => {
    const env = envelope([photo()])
    await saveExceptionEnvelope(env)
    let release: (value: { id: string; file_hash: string }) => void = () => {}
    upload.mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
    const post = vi.fn().mockResolvedValue({})

    const first = sendExceptionReport(env, { durable: true, post })
    const second = await sendExceptionReport(env, { durable: true, post })
    release({ id: 'a1', file_hash: 'h' })

    expect(second).toEqual({ kind: 'busy' })
    expect((await first).kind).toBe('acknowledged')
  })

  test('test_lock_released_after_failure', async () => {
    const env = envelope([])
    await saveExceptionEnvelope(env)

    const first = await sendExceptionReport(env, { durable: true, post: vi.fn().mockRejectedValue(new Error('x')) })
    const second = await sendExceptionReport(env, { durable: true, post: vi.fn().mockResolvedValue({}) })

    expect(first.kind).toBe('transient')
    expect(second.kind).toBe('acknowledged')
  })

  test('test_non_durable_mode_resumes_without_reupload_and_clears_on_ack', async () => {
    const env = envelope([photo(), photo()])
    uploadsSucceedWith('a1')
    upload.mockRejectedValueOnce(new ApiError(0, 'offline'))
    await sendExceptionReport(env, { durable: false, post: vi.fn() })
    upload.mockClear()
    uploadsSucceedWith('a2')
    const post = vi.fn().mockResolvedValue({})

    const resumed = await sendExceptionReport(env, { durable: false, post })
    upload.mockClear()
    uploadsSucceedWith('b1', 'b2')
    await sendExceptionReport(env, { durable: false, post })

    expect(resumed.kind).toBe('acknowledged')
    expect(post).toHaveBeenNthCalledWith(1, ['a1', 'a2'])
    // After the ack the memory is cleared, so the same envelope starts from scratch.
    expect(upload).toHaveBeenCalledTimes(2)
  })

  test('test_429_returns_transient_with_retryAfterMs', async () => {
    const env = envelope([])
    await saveExceptionEnvelope(env)
    const post = vi.fn().mockRejectedValue(new ApiError(429, 'slow down', 7000))

    const outcome = await sendExceptionReport(env, { durable: true, post })

    expect(outcome).toEqual({ kind: 'transient', retryAfterMs: 7000 })
  })

  test('test_429_without_retry_after_returns_transient_with_default_delay', async () => {
    const env = envelope([])
    await saveExceptionEnvelope(env)
    const post = vi.fn().mockRejectedValue(new ApiError(429, 'slow down'))

    const outcome = await sendExceptionReport(env, { durable: true, post })

    expect(outcome).toEqual({ kind: 'transient', retryAfterMs: DEFAULT_RATE_LIMIT_RETRY_MS })
  })

  test('test_ack_removes_envelope', async () => {
    const env = envelope([photo()])
    await saveExceptionEnvelope(env)
    uploadsSucceedWith('a1')

    await sendExceptionReport(env, { durable: true, post: vi.fn().mockResolvedValue({}) })

    expect(await getExceptionEnvelope(env.clientReportId)).toBeNull()
  })

  test('test_onProgress_called_per_upload', async () => {
    const env = envelope([photo(), photo()])
    await saveExceptionEnvelope(env)
    uploadsSucceedWith('a1', 'a2')
    const onProgress = vi.fn()

    await sendExceptionReport(env, { durable: true, post: vi.fn().mockResolvedValue({}), onProgress })

    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  test('test_failed_progress_write_does_not_cause_a_second_upload_of_that_photo', async () => {
    const idb = createFakeIndexedDb()
    __setIndexedDbForTests(idb)
    const env = envelope([photo(), photo()])
    await saveExceptionEnvelope(env)
    // The initial save succeeded; from here the store refuses every write, including
    // the "photo 1 uploaded" record.
    idb.failPuts()
    upload.mockResolvedValueOnce({ id: 'a1', file_hash: 'h' })
    upload.mockRejectedValueOnce(new ApiError(0, 'offline'))
    const post = vi.fn().mockResolvedValue({})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const first = await sendExceptionReport(env, { durable: true, post })
    // Same (stale) envelope again, exactly what a retry from the page would hold.
    upload.mockResolvedValueOnce({ id: 'a2', file_hash: 'h' })
    const second = await sendExceptionReport(env, { durable: true, post })

    expect(first).toEqual({ kind: 'transient', retryAfterMs: null })
    expect(second).toEqual({ kind: 'acknowledged' })
    expect(upload).toHaveBeenCalledTimes(3) // photo 1 once, photo 2 twice (first failed) - never photo 1 twice
    expect(post).toHaveBeenCalledWith(['a1', 'a2'])
  })

  test('test_waitReportLock_serves_waiters_in_order_and_blocks_tryReportLock_meanwhile', async () => {
    const releaseFirst = tryReportLock('r1')
    expect(releaseFirst).not.toBeNull()
    expect(tryReportLock('r1')).toBeNull()
    const order: string[] = []
    const second = waitReportLock('r1').then((release) => { order.push('second'); return release })
    const third = waitReportLock('r1').then((release) => { order.push('third'); return release })

    releaseFirst?.()
    const releaseSecond = await second
    // Handed over without a gap: a non-waiting caller still cannot take it.
    expect(tryReportLock('r1')).toBeNull()
    releaseSecond()
    const releaseThird = await third
    releaseThird()

    expect(order).toEqual(['second', 'third'])
    expect(tryReportLock('r1')).not.toBeNull()
  })

  test('test_send_without_lockHeld_is_busy_while_the_lock_is_held_elsewhere', async () => {
    const env = envelope([])
    const release = tryReportLock(env.clientReportId)

    const outcome = await sendExceptionReport(env, { durable: true, post: vi.fn() })
    release?.()

    expect(outcome).toEqual({ kind: 'busy' })
  })
})

describe('actor interruption', () => {
  test.each([false, true])('stops_after_account_generation_changes (return=%s)', async (returns) => {
    const { setCustodyContext } = await import('@/lib/session/custody-context')
    const actorId = crypto.randomUUID()
    const env = { ...envelope([photo(), photo()]), actorId }
    bindActorLease(actorId, invalidateActorLease())
    setCustodyContext({ actorId, tripId: env.tripId, custodySequence: 0 })
    await saveExceptionEnvelope(env)
    let release!: (value: { id: string; file_hash: string }) => void
    upload.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const post = vi.fn()
    const sending = sendExceptionReport(env, { durable: true, post })
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    bindActorLease(crypto.randomUUID(), invalidateActorLease())
    if (returns) bindActorLease(actorId, invalidateActorLease())
    release({ id: 'first-upload', file_hash: 'hash' })

    expect((await sending).kind).toBe('not-yours')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(post).not.toHaveBeenCalled()
    const kept = await getExceptionEnvelope(env.clientReportId)
    expect(kept?.photos[0].uploadedArtifactId).toBe('first-upload')
    expect(kept?.photos[1].blob).not.toBeNull()
    invalidateActorLease()
  })
})
