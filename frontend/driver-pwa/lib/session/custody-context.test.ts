import { beforeEach, expect, test } from 'vitest'
import * as context from './custody-context'

beforeEach(() => context.__resetCustodyContextForTests())

test('actor_lease_does_not_revive_after_A_B_A', () => {
  const a = crypto.randomUUID()
  context.bindActorLease(a, context.invalidateActorLease())
  const lease = context.captureActorLease()!
  context.bindActorLease(crypto.randomUUID(), context.invalidateActorLease())
  context.bindActorLease(a, context.invalidateActorLease())
  expect(context.isActorLeaseCurrent(lease)).toBe(false)
})

test('stale_profile_and_trip_render_cannot_rebind', () => {
  const generation = context.invalidateActorLease()
  context.invalidateActorLease()
  expect(context.bindActorLease('old-driver', generation)).toBe(false)
  context.setCustodyContext({ actorId: 'old-driver', tripId: 'trip', custodySequence: 2 })
  expect(context.currentActorId()).toBeNull()
})

test('same_account_token_refresh_keeps_lease', () => {
  const generation = context.observeAuthSession('auth-a')
  context.bindActorLease('driver-a', generation)
  const lease = context.captureActorLease()!
  expect(context.observeAuthSession('auth-a')).toBe(generation)
  expect(context.isActorLeaseCurrent(lease)).toBe(true)
  context.observeAuthSession(null)
  expect(context.isActorLeaseCurrent(lease)).toBe(false)
})
