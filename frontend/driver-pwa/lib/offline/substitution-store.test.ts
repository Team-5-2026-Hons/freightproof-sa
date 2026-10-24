import { expect, test } from 'vitest'
import { __setSubstitutionIndexedDbForTests, getCapture, saveCapture } from './substitution-store'
import { createFakeIndexedDb } from './testing/fake-indexeddb'
import { newCapture } from '@/lib/hooks/useSubstitutionCapture'
import { substitutionFixturePack as pack } from '@shared/lib/mocks/driver-substitutions'

test('unavailable_reason_survives_restart', async () => {
  const factory = createFakeIndexedDb()
  __setSubstitutionIndexedDbForTests(factory)
  const capture = { ...newCapture(pack.contextWithFindings.incoming.id, pack.contextWithFindings, 'incoming'), locationUnavailableReason: 'permission_denied' as const }
  await saveCapture(capture)
  __setSubstitutionIndexedDbForTests(factory)
  expect(await getCapture(capture.key)).toMatchObject({ locationObservedAt: null, locationUnavailableReason: 'permission_denied', position: null })
})

test('old_submitted_body_is_not_enriched_on_retry', async () => {
  const factory = createFakeIndexedDb()
  __setSubstitutionIndexedDbForTests(factory)
  const capture = newCapture(pack.contextWithFindings.outgoing.id, pack.contextWithFindings, 'outgoing')
  const { captureFormat: _format, locationObservedAt: _observed, locationUnavailableReason: _reason, ...old } = capture
  const body = { client_request_id: crypto.randomUUID(), expected_version: 1, captured_at: new Date().toISOString(), confirmed_vehicle_ids: [pack.contextWithFindings.vehicles[0].id], seal_checks: [], latitude: null, longitude: null, accuracy_metres: null, discrepancy_note: null }
  await saveCapture({ ...old, submittedBody: body })
  __setSubstitutionIndexedDbForTests(factory)
  const read = await getCapture(capture.key)
  expect(read?.submittedBody).toEqual(body)
  expect(read?.locationObservedAt).toBeNull()
  expect(read?.captureFormat).toBeNull()
})
