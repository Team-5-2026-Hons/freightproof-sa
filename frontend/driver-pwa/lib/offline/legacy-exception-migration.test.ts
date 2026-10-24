import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { uploadArtifact } from '@/lib/api/artifacts'
import {
  __setIndexedDbForTests,
  getExceptionEnvelope,
  listExceptionEnvelopes,
  saveExceptionEnvelope,
} from './exception-store'
import { __resetExceptionSyncForTests, dataUrlToBlob, sendExceptionReport } from './exception-sync'
import {
  legacyEntryToEnvelope,
  migrateLegacyExceptionEntries,
  type LegacyExceptionEntry,
} from './legacy-exception-migration'
import { createFakeIndexedDb, type FakeIndexedDbFactory } from './testing/fake-indexeddb'

vi.mock('@/lib/api/artifacts', () => ({ uploadArtifact: vi.fn() }))

const upload = vi.mocked(uploadArtifact)
const DATA_URL = 'data:image/jpeg;base64,aGVsbG8='

function entry(overrides: Partial<LegacyExceptionEntry> = {}): LegacyExceptionEntry {
  return {
    kind: 'exception',
    id: crypto.randomUUID(),
    tripId: crypto.randomUUID(),
    body: { exception_type: 'mechanical', description: 'Flat tyre', client_report_id: crypto.randomUUID() },
    enqueuedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  }
}

let fake: FakeIndexedDbFactory

beforeEach(() => {
  fake = createFakeIndexedDb()
  __setIndexedDbForTests(fake)
  __resetExceptionSyncForTests()
  upload.mockReset()
})

afterEach(() => {
  __setIndexedDbForTests(null)
})

describe('legacy exception migration', () => {
  test('test_legacy_entry_with_photo_dataurl_becomes_envelope', async () => {
    const e = entry({ photoDataUrl: DATA_URL, photoCapturedAt: '2026-10-01T07:59:00.000Z' })
    const dropLegacy = vi.fn()

    const result = await migrateLegacyExceptionEntries({ readLegacy: () => [e], dropLegacy })

    const stored = await getExceptionEnvelope(e.body.client_report_id!)
    expect(result).toEqual({ migrated: 1, failed: 0 })
    expect(stored?.photos).toHaveLength(1)
    expect(stored?.photos[0].id).toBe(`legacy-photo:${e.id}`)
    expect(stored?.photos[0].capturedAt).toBe('2026-10-01T07:59:00.000Z')
    expect(stored?.photos[0].uploadedArtifactId).toBeNull()
    expect(stored?.photos[0].blob).toBeInstanceOf(Blob)
    expect(stored?.body).not.toHaveProperty('supporting_artifact_id')
    expect(stored).toMatchObject({ status: 'quarantined', actorId: null })
    expect(dropLegacy).toHaveBeenCalledWith([e.id])
  })

  test('test_legacy_entry_with_uploaded_artifact_id_keeps_id_in_quarantine_without_sending', async () => {
    const e = entry()
    e.body = { ...e.body, supporting_artifact_id: 'known-artifact' }

    await migrateLegacyExceptionEntries({ readLegacy: () => [e], dropLegacy: vi.fn() })
    const stored = await getExceptionEnvelope(e.body.client_report_id!)
    const post = vi.fn().mockResolvedValue({})
    const outcome = await sendExceptionReport(stored!, { durable: true, post })

    expect(stored?.photos[0]).toMatchObject({ blob: null, uploadedArtifactId: 'known-artifact' })
    expect(outcome.kind).toBe('not-yours')
    expect(upload).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(await getExceptionEnvelope(e.body.client_report_id!)).toMatchObject({ status: 'quarantined', actorId: null })
  })

  test('test_legacy_entry_with_dataurl_and_known_id_keeps_both', () => {
    const e = entry({ photoDataUrl: DATA_URL })
    e.body = { ...e.body, supporting_artifact_id: 'known-artifact' }

    const env = legacyEntryToEnvelope(e)

    expect(env.photos[0].blob).toBeInstanceOf(Blob)
    expect(env.photos[0].uploadedArtifactId).toBe('known-artifact')
    expect(env.photos[0].capturedAt).toBe(e.enqueuedAt)
  })

  test('test_legacy_photoless_entry_migrates', async () => {
    const e = entry()

    const result = await migrateLegacyExceptionEntries({ readLegacy: () => [e], dropLegacy: vi.fn() })

    const stored = await getExceptionEnvelope(e.body.client_report_id!)
    expect(result.migrated).toBe(1)
    expect(stored?.photos).toEqual([])
  })

  test('test_envelope_written_before_legacy_entry_dropped', async () => {
    const e = entry({ photoDataUrl: DATA_URL })
    const checks: Promise<boolean>[] = []

    await migrateLegacyExceptionEntries({
      readLegacy: () => [e],
      // dropLegacy is synchronous, so start the store read here and settle it afterwards.
      dropLegacy: () => {
        checks.push(getExceptionEnvelope(e.body.client_report_id!).then((stored) => stored !== null))
        return true
      },
    })

    expect(await Promise.all(checks)).toEqual([true])
  })

  test('test_store_failure_leaves_legacy_entry_in_place_and_counts_failed', async () => {
    const e = entry({ photoDataUrl: DATA_URL })
    fake.failPuts()
    const dropLegacy = vi.fn()

    const result = await migrateLegacyExceptionEntries({ readLegacy: () => [e], dropLegacy })

    expect(result).toEqual({ migrated: 0, failed: 1 })
    expect(dropLegacy).not.toHaveBeenCalled()
  })

  test('test_rerun_after_crash_between_write_and_drop_dedupes_and_keeps_recorded_id', async () => {
    const e = entry({ photoDataUrl: DATA_URL })
    // First run wrote the envelope, uploaded the photo, then the tab died before dropLegacy.
    const first = legacyEntryToEnvelope(e)
    await saveExceptionEnvelope({
      ...first,
      photos: first.photos.map((p) => ({ ...p, uploadedArtifactId: 'recorded' })),
    })

    const result = await migrateLegacyExceptionEntries({ readLegacy: () => [e], dropLegacy: vi.fn() })

    const all = await listExceptionEnvelopes()
    expect(result.migrated).toBe(1)
    expect(all).toHaveLength(1)
    expect(all[0].photos[0].uploadedArtifactId).toBe('recorded')
  })

  test('test_duplicate_report_ids_in_batch_produce_one_envelope', async () => {
    const shared = crypto.randomUUID()
    const a = entry()
    const b = entry()
    a.body = { ...a.body, client_report_id: shared }
    b.body = { ...b.body, client_report_id: shared }
    const dropLegacy = vi.fn()

    await migrateLegacyExceptionEntries({ readLegacy: () => [a, b], dropLegacy })

    expect(await listExceptionEnvelopes()).toHaveLength(1)
    const dropped = dropLegacy.mock.calls.flatMap((c) => c[0] as string[])
    expect(dropped.sort()).toEqual([a.id, b.id].sort())
  })

  test('test_duplicate_report_ids_keep_the_union_of_distinct_photos', async () => {
    const shared = crypto.randomUUID()
    const a = entry({ photoDataUrl: DATA_URL })
    const b = entry({ photoDataUrl: 'data:image/jpeg;base64,d29ybGQ=' })
    a.body = { ...a.body, client_report_id: shared }
    b.body = { ...b.body, client_report_id: shared }

    await migrateLegacyExceptionEntries({ readLegacy: () => [a, b], dropLegacy: vi.fn() })

    const [stored] = await listExceptionEnvelopes()
    expect(stored.photos.map((p) => p.id)).toEqual([`legacy-photo:${a.id}`, `legacy-photo:${b.id}`])
  })

  test('test_failed_drop_counts_as_failed', async () => {
    const e = entry({ photoDataUrl: DATA_URL })

    const result = await migrateLegacyExceptionEntries({ readLegacy: () => [e], dropLegacy: () => false })

    expect(result).toEqual({ migrated: 0, failed: 1 })
  })

  test('test_client_report_id_falls_back_to_entry_id', () => {
    const e = entry()
    e.body = { exception_type: 'mechanical', description: 'x' }

    expect(legacyEntryToEnvelope(e).clientReportId).toBe(e.id)
  })
})

describe('dataUrlToBlob', () => {
  test('test_round_trips_bytes_and_type', async () => {
    const blob = dataUrlToBlob(DATA_URL)

    expect(blob.type).toBe('image/jpeg')
    expect(blob.size).toBe(5)
  })
})
