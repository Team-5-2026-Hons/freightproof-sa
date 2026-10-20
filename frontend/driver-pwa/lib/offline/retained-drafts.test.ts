import { beforeEach, expect, test } from 'vitest'
import { listRetainedDrafts, readDraft, writeDraft } from './retained-drafts'

beforeEach(() => localStorage.clear())

test('unknown_period_after_return_is_retained', () => {
  const trip = crypto.randomUUID()
  const phase = crypto.randomUUID()
  const actor = crypto.randomUUID()
  const draft = { photo: 'original bytes', key: crypto.randomUUID() }
  writeDraft(trip, phase, { actorId: actor, custodySequence: null }, draft)

  expect(readDraft(trip, phase, { actorId: actor, custodySequence: 2 })).toBeNull()
  expect(listRetainedDrafts()).toEqual([expect.objectContaining({ actorId: actor, custodySequence: null, draft })])
})

test('unknown_period_before_any_transfer_remains_compatible', () => {
  const trip = crypto.randomUUID()
  const phase = crypto.randomUUID()
  const actor = crypto.randomUUID()
  writeDraft(trip, phase, { actorId: actor, custodySequence: null }, { note: 'kept' })
  expect(readDraft(trip, phase, { actorId: actor, custodySequence: 0 })).toEqual({ note: 'kept' })
})
