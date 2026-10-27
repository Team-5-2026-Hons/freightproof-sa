import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  ExceptionStoreError,
  __setIndexedDbForTests,
  getExceptionEnvelope,
  listExceptionEnvelopes,
  markExceptionNeedsAttention,
  recordPhotoUploaded,
  removeExceptionEnvelope,
  resetExceptionToPending,
  saveExceptionEnvelope,
  type ExceptionEnvelope,
  type ExceptionPhotoRecord,
} from './exception-store'
import { createFakeIndexedDb, type FakeIndexedDbFactory } from './testing/fake-indexeddb'

function photo(overrides: Partial<ExceptionPhotoRecord> = {}): ExceptionPhotoRecord {
  return {
    id: crypto.randomUUID(),
    blob: new Blob(['bytes'], { type: 'image/jpeg' }),
    capturedAt: new Date().toISOString(),
    uploadedArtifactId: null,
    ...overrides,
  }
}

function envelope(overrides: Partial<ExceptionEnvelope> = {}): ExceptionEnvelope {
  const now = new Date().toISOString()
  return {
    clientReportId: crypto.randomUUID(),
    tripId: crypto.randomUUID(),
    body: { exception_type: 'mechanical', description: 'Flat tyre' },
    photos: [],
    status: 'pending',
    attentionReason: null,
    attentionPhotoId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

let fake: FakeIndexedDbFactory

beforeEach(() => {
  fake = createFakeIndexedDb()
  __setIndexedDbForTests(fake)
})

afterEach(() => {
  __setIndexedDbForTests(null)
})

describe('exception store', () => {
  test('test_save_round_trips_envelope_with_blob_photos_in_order', async () => {
    const first = photo({ blob: new Blob(['one']) })
    const second = photo({ blob: new Blob(['two']) })
    const env = envelope({ photos: [first, second] })

    await saveExceptionEnvelope(env)
    const loaded = await getExceptionEnvelope(env.clientReportId)

    expect(loaded?.photos.map((p) => p.id)).toEqual([first.id, second.id])
    expect(loaded?.photos[0].blob).toBeInstanceOf(Blob)
    expect(loaded?.body.description).toBe('Flat tyre')
  })

  test('test_get_returns_null_for_unknown_report', async () => {
    expect(await getExceptionEnvelope(crypto.randomUUID())).toBeNull()
  })

  test('test_list_sorts_by_created_at_ascending', async () => {
    const late = envelope({ createdAt: '2026-10-02T00:00:00.000Z' })
    const early = envelope({ createdAt: '2026-10-01T00:00:00.000Z' })
    await saveExceptionEnvelope(late)
    await saveExceptionEnvelope(early)

    const all = await listExceptionEnvelopes()

    expect(all.map((e) => e.clientReportId)).toEqual([early.clientReportId, late.clientReportId])
  })

  test('test_upsert_keeps_original_created_at', async () => {
    const env = envelope({ createdAt: '2026-10-01T00:00:00.000Z' })
    await saveExceptionEnvelope(env)

    await saveExceptionEnvelope({ ...env, createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' })
    const loaded = await getExceptionEnvelope(env.clientReportId)

    expect(loaded?.createdAt).toBe('2026-10-01T00:00:00.000Z')
    expect(loaded?.updatedAt).toBe('2026-10-09T00:00:00.000Z')
  })

  test('test_upsert_carries_recorded_artifact_id_when_incoming_is_null', async () => {
    const p = photo({ uploadedArtifactId: 'artifact-1' })
    const env = envelope({ photos: [p] })
    await saveExceptionEnvelope(env)

    await saveExceptionEnvelope({ ...env, photos: [{ ...p, uploadedArtifactId: null }] })
    const loaded = await getExceptionEnvelope(env.clientReportId)

    expect(loaded?.photos[0].uploadedArtifactId).toBe('artifact-1')
  })

  test('test_upsert_does_not_clobber_non_null_incoming_artifact_id', async () => {
    const p = photo({ uploadedArtifactId: 'artifact-old' })
    const env = envelope({ photos: [p] })
    await saveExceptionEnvelope(env)

    await saveExceptionEnvelope({ ...env, photos: [{ ...p, uploadedArtifactId: 'artifact-new' }] })
    const loaded = await getExceptionEnvelope(env.clientReportId)

    expect(loaded?.photos[0].uploadedArtifactId).toBe('artifact-new')
  })

  test('test_record_photo_uploaded_persists_artifact_id', async () => {
    const p = photo()
    const env = envelope({ photos: [p] })
    await saveExceptionEnvelope(env)

    await recordPhotoUploaded(env.clientReportId, p.id, 'artifact-9')
    const loaded = await getExceptionEnvelope(env.clientReportId)

    expect(loaded?.photos[0].uploadedArtifactId).toBe('artifact-9')
  })

  test('test_record_photo_uploaded_is_noop_for_missing_report_or_photo', async () => {
    const env = envelope({ photos: [photo()] })
    await saveExceptionEnvelope(env)

    await recordPhotoUploaded(crypto.randomUUID(), 'x', 'artifact-1')
    await recordPhotoUploaded(env.clientReportId, 'no-such-photo', 'artifact-1')
    const loaded = await getExceptionEnvelope(env.clientReportId)

    expect(loaded?.photos[0].uploadedArtifactId).toBeNull()
    expect(await getExceptionEnvelope('missing')).toBeNull()
  })

  test('test_needs_attention_sets_fields_and_reset_clears_them', async () => {
    const p = photo()
    const env = envelope({ photos: [p] })
    await saveExceptionEnvelope(env)

    await markExceptionNeedsAttention(env.clientReportId, 'Server said no', p.id)
    const flagged = await getExceptionEnvelope(env.clientReportId)
    await resetExceptionToPending(env.clientReportId)
    const reset = await getExceptionEnvelope(env.clientReportId)

    expect(flagged).toMatchObject({ status: 'needs-attention', attentionReason: 'Server said no', attentionPhotoId: p.id })
    expect(reset).toMatchObject({ status: 'pending', attentionReason: null, attentionPhotoId: null })
  })

  test('test_remove_deletes_the_envelope', async () => {
    const env = envelope()
    await saveExceptionEnvelope(env)

    await removeExceptionEnvelope(env.clientReportId)

    expect(await getExceptionEnvelope(env.clientReportId)).toBeNull()
  })

  test('test_data_survives_reopening_the_connection', async () => {
    const env = envelope({ photos: [photo()] })
    await saveExceptionEnvelope(env)

    __setIndexedDbForTests(fake)
    const loaded = await getExceptionEnvelope(env.clientReportId)

    expect(loaded?.clientReportId).toBe(env.clientReportId)
    expect(loaded?.photos).toHaveLength(1)
  })

  test('test_unavailable_indexeddb_rejects_with_unavailable_failure', async () => {
    fake.setUnavailable(true)

    const result = saveExceptionEnvelope(envelope())

    await expect(result).rejects.toBeInstanceOf(ExceptionStoreError)
    await expect(result).rejects.toMatchObject({ failure: 'unavailable' })
  })

  test('test_missing_indexeddb_rejects_with_unavailable_failure', async () => {
    __setIndexedDbForTests(null)

    await expect(listExceptionEnvelopes()).rejects.toMatchObject({ failure: 'unavailable' })
  })

  test('test_quota_failure_on_put_rejects_with_quota_and_keeps_previous_record', async () => {
    const env = envelope({ body: { exception_type: 'mechanical', description: 'original' } })
    await saveExceptionEnvelope(env)
    fake.failPuts()

    const attempt = saveExceptionEnvelope({ ...env, body: { ...env.body, description: 'changed' } })

    await expect(attempt).rejects.toMatchObject({ failure: 'quota' })
    const loaded = await getExceptionEnvelope(env.clientReportId)
    expect(loaded?.body.description).toBe('original')
  })
})
