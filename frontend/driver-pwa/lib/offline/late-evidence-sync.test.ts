import { beforeEach, expect, test, vi } from 'vitest'
import { sendLateEvidence } from './late-evidence-sync'
import { createFakeIndexedDb } from './testing/fake-indexeddb'
import { __setIndexedDbForTests, saveExceptionEnvelope, getExceptionEnvelope, type ExceptionEnvelope } from './exception-store'
import { __setSubstitutionIndexedDbForTests, getLateProgress } from './substitution-store'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'
import { uploadLateEvidenceArtifact, submitLateEvidence } from '@/lib/api/driver-substitutions'
import { retainedAttention } from './live-write-conflict'

vi.mock('@/lib/api/driver-substitutions', () => ({ uploadLateEvidenceArtifact: vi.fn(), submitLateEvidence: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  const factory = createFakeIndexedDb()
  __setIndexedDbForTests(factory)
  __setSubstitutionIndexedDbForTests(factory)
})

test('stops_after_account_generation_changes', async () => {
  const actorId = crypto.randomUUID()
  bindActorLease(actorId, invalidateActorLease())
  const now = new Date().toISOString()
  const envelope: ExceptionEnvelope = {
    clientReportId: crypto.randomUUID(), tripId: crypto.randomUUID(), actorId,
    body: { exception_type: 'mechanical', description: 'Flat tyre', custody_sequence: 0 },
    photos: [0, 1].map(() => ({ id: crypto.randomUUID(), blob: new Blob(['original bytes']), capturedAt: now, uploadedArtifactId: null })),
    status: 'needs-attention' as const, attention: retainedAttention('TRIP_HANDED_OVER', 409, 'Kept'),
    attentionReason: 'Kept', attentionPhotoId: null, createdAt: now, updatedAt: now,
  }
  await saveExceptionEnvelope(envelope)
  let release!: (value: { id: string }) => void
  vi.mocked(uploadLateEvidenceArtifact).mockImplementationOnce(() => new Promise((resolve) => { release = resolve as typeof release }))
  const sending = sendLateEvidence({ origin: 'exception', envelope })
  await vi.waitFor(() => expect(uploadLateEvidenceArtifact).toHaveBeenCalledTimes(1))
  bindActorLease(crypto.randomUUID(), invalidateActorLease())
  bindActorLease(actorId, invalidateActorLease())
  release({ id: 'retained-upload' })
  await sending
  expect(uploadLateEvidenceArtifact).toHaveBeenCalledTimes(1)
  expect(submitLateEvidence).not.toHaveBeenCalled()
  expect((await getLateProgress(envelope.clientReportId))?.uploads).toEqual(expect.objectContaining({
    [`photo:${envelope.photos[0].id}`]: expect.objectContaining({ artifactId: 'retained-upload' }),
  }))
  expect((await getExceptionEnvelope(envelope.clientReportId))?.photos).toHaveLength(2)
})
