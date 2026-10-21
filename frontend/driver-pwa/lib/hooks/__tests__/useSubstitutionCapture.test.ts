import { beforeEach, expect, test, vi } from 'vitest'
import { newCapture, sendSubstitutionCapture } from '../useSubstitutionCapture'
import { substitutionFixturePack } from '@shared/lib/mocks/driver-substitutions'
import { bindActorLease, invalidateActorLease } from '@/lib/session/custody-context'
import { __setSubstitutionIndexedDbForTests, getCapture, saveCapture } from '@/lib/offline/substitution-store'
import { createFakeIndexedDb } from '@/lib/offline/testing/fake-indexeddb'
import { uploadSubstitutionArtifact, confirmDriverSubstitution, fetchDriverSubstitutionContext } from '@/lib/api/driver-substitutions'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSubstitutionCapture } from '../useSubstitutionCapture'

vi.mock('@/lib/api/driver-substitutions', () => ({ uploadSubstitutionArtifact: vi.fn(), confirmDriverSubstitution: vi.fn(), fetchDriverSubstitutionContext: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  __setSubstitutionIndexedDbForTests(createFakeIndexedDb())
})

test('stops_after_account_generation_changes', async () => {
  const context = substitutionFixturePack.contextWithFindings
  const actorId = context.outgoing.id
  bindActorLease(actorId, invalidateActorLease())
  const capture = newCapture(actorId, context, 'outgoing')
  capture.status = 'sending'
  capture.capturedAt = new Date().toISOString()
  capture.sealChecks[0].photos = [0, 1].map(() => ({ id: crypto.randomUUID(), dataUrl: 'original bytes', capturedAt: capture.capturedAt!, uploadRequestId: crypto.randomUUID(), uploadedArtifactId: null }))
  await saveCapture(capture)
  let release!: (value: { id: string }) => void
  vi.mocked(uploadSubstitutionArtifact).mockImplementationOnce(() => new Promise((resolve) => { release = resolve as typeof release }))
  const sending = sendSubstitutionCapture(capture.key)
  await vi.waitFor(() => expect(uploadSubstitutionArtifact).toHaveBeenCalledTimes(1))
  bindActorLease(crypto.randomUUID(), invalidateActorLease())
  bindActorLease(actorId, invalidateActorLease())
  release({ id: 'first-upload' })
  await sending
  expect(uploadSubstitutionArtifact).toHaveBeenCalledTimes(1)
  expect(confirmDriverSubstitution).not.toHaveBeenCalled()
  expect((await getCapture(capture.key))?.sealChecks[0].photos).toEqual([
    expect.objectContaining({ uploadedArtifactId: 'first-upload', dataUrl: 'original bytes' }),
    expect.objectContaining({ uploadedArtifactId: null, dataUrl: 'original bytes' }),
  ])
})

test('declaration_and_observation_are_independent', async () => {
  const { confirmationBody } = await import('../useSubstitutionCapture')
  const context = substitutionFixturePack.contextWithFindings
  const declaration = new Date(Date.now() - 90_000).toISOString()
  const observation = new Date(Date.now() - 60_000).toISOString()
  const capture = { ...newCapture(context.incoming.id, context, 'incoming'), capturedAt: declaration,
    position: { latitude: -30, longitude: 25, accuracyMetres: 8 }, locationObservedAt: observation, locationUnavailableReason: null }
  const body = confirmationBody(capture)
  expect(body).toMatchObject({ capture_format: 'observation_v2', captured_at: declaration, location_observed_at: observation })
})

test('a_confirmation_receipt_after_account_change_starts_no_followup_context_request', async () => {
  const context = substitutionFixturePack.contextWithFindings
  const actorId = context.outgoing.id
  bindActorLease(actorId, invalidateActorLease())
  const capture = newCapture(actorId, context, 'outgoing')
  capture.confirmedVehicleIds = context.vehicles.map(vehicle => vehicle.id)
  capture.sealChecks = capture.sealChecks.map(check => ({ ...check, condition: 'not_applicable', notApplicableReason: 'Empty leg' }))
  await saveCapture(capture)
  vi.mocked(fetchDriverSubstitutionContext).mockResolvedValue(context)
  let deliver!: (value: typeof substitutionFixturePack.oneConfirmation) => void
  vi.mocked(confirmDriverSubstitution).mockImplementationOnce(() => new Promise(resolve => { deliver = resolve }))
  const { result } = renderHook(() => useSubstitutionCapture(context.trip_id, context.id, actorId))
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  let sending!: ReturnType<typeof result.current.submit>
  act(() => { sending = result.current.submit() })
  await waitFor(() => expect(confirmDriverSubstitution).toHaveBeenCalledOnce())
  bindActorLease(crypto.randomUUID(), invalidateActorLease())
  await act(async () => { deliver(substitutionFixturePack.oneConfirmation); await sending })

  expect(fetchDriverSubstitutionContext).toHaveBeenCalledOnce()
  expect(await getCapture(capture.key)).toMatchObject({ actorId, status: 'saved' })
})
