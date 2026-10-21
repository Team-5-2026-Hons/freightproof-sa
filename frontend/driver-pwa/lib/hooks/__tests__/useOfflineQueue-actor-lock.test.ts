import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useOfflineQueue, __resetOfflineQueueStoreForTests } from '../useOfflineQueue'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'
import { tryReportLock, __resetExceptionSyncForTests } from '@/lib/offline/exception-sync'
import { __setIndexedDbForTests, getExceptionEnvelope } from '@/lib/offline/exception-store'
import { createFakeIndexedDb } from '@/lib/offline/testing/fake-indexeddb'

vi.mock('@/lib/api/phases', () => ({ submitPhase: vi.fn() }))
vi.mock('@/lib/api/checkpoints', () => ({ submitCheckpoint: vi.fn() }))
vi.mock('@/lib/api/exceptions', () => ({ raiseException: vi.fn() }))
vi.mock('@/lib/api/artifacts', () => ({ uploadArtifact: vi.fn() }))

beforeEach(() => {
  localStorage.clear()
  __setIndexedDbForTests(createFakeIndexedDb())
  __resetExceptionSyncForTests()
  __resetOfflineQueueStoreForTests()
  bindActorLease('driver-a', invalidateActorLease())
})

it('an_exception_waiting_for_its_save_lock_cannot_restart_after_A_B_A', async () => {
  const { result } = renderHook(() => useOfflineQueue())
  const id = crypto.randomUUID()
  const release = tryReportLock(id)!
  const post = vi.fn().mockResolvedValue({ id: 'receipt' })
  let sending!: ReturnType<typeof result.current.submitExceptionReport>
  act(() => {
    sending = result.current.submitExceptionReport({ tripId: 'trip', clientReportId: id,
      body: { exception_type: 'mechanical', description: 'Original actor evidence', driver_captured_at: new Date().toISOString() },
      photos: [],
    }, post)
  })
  bindActorLease('driver-b', invalidateActorLease())
  bindActorLease('driver-a', invalidateActorLease())
  release()
  await act(async () => { expect(await sending).toEqual({ kind: 'saved-for-later' }) })
  expect(post).not.toHaveBeenCalled()
  expect(await getExceptionEnvelope(id)).toMatchObject({ actorId: 'driver-a', body: { description: 'Original actor evidence' } })
})
