import { describe, it, expect } from 'vitest'
import {
  blockedConfirmationFixtures,
  substitutionFixturePack as pack,
} from '@shared/lib/mocks/driver-substitutions'
import type { SubstitutionRequestRead } from '@shared/lib/types/driver-substitution'
import {
  blockerMessage,
  counterpartOf,
  identityLabel,
  substitutionRoleFor,
  substitutionStatusLine,
} from '../driver-substitution'

const outgoingId = pack.outgoingPending.outgoing.id
const incomingId = pack.outgoingPending.incoming.id

describe('substitutionRoleFor', () => {
  it('test_named_contacts_decide_the_role', () => {
    expect(substitutionRoleFor(pack.outgoingPending, incomingId)).toBe('incoming')
    expect(substitutionRoleFor(pack.outgoingPending, outgoingId)).toBe('outgoing')
  })

  it('test_permitted_actions_are_only_a_fallback', () => {
    const unnamed: SubstitutionRequestRead = { ...pack.incomingPendingNoActiveTrip.pending[0] }

    expect(substitutionRoleFor(unnamed, crypto.randomUUID())).toBe('incoming')
  })

  it('test_unrelated_driver_gets_no_role', () => {
    const noActions: SubstitutionRequestRead = { ...pack.outgoingPending, permitted_actions: [] }

    expect(substitutionRoleFor(noActions, crypto.randomUUID())).toBeNull()
  })
})

describe('counterpartOf', () => {
  it('test_each_side_sees_the_other_driver', () => {
    expect(counterpartOf(pack.outgoingPending, 'incoming').id).toBe(outgoingId)
    expect(counterpartOf(pack.outgoingPending, 'outgoing').id).toBe(incomingId)
  })
})

describe('substitutionStatusLine', () => {
  it('test_unconfirmed_driver_is_asked_for_their_check', () => {
    expect(substitutionStatusLine(pack.incomingPendingNoActiveTrip.pending[0], 'incoming'))
      .toBe('Waiting for your handover check')
  })

  it('test_confirmed_driver_waits_for_the_counterpart_by_name', () => {
    expect(substitutionStatusLine(pack.oneConfirmation, 'outgoing'))
      .toBe(`Waiting for ${pack.oneConfirmation.incoming.full_name}`)
  })

  it('test_saved_but_blocked_never_reads_as_complete', () => {
    expect(substitutionStatusLine(pack.savedButBlocked, 'incoming')).toBe('Saved — waiting on dispatch')
  })

  it('test_terminal_states_follow_the_server', () => {
    expect(substitutionStatusLine(pack.normalCompleted, 'incoming')).toBe('Handover complete')
    expect(substitutionStatusLine(pack.cancelled, 'incoming')).toBe('Handover cancelled')
    expect(substitutionStatusLine(pack.replaced.old, 'incoming')).toBe('Replaced by a new arrangement')
  })
})

describe('blockerMessage and identityLabel', () => {
  it('test_every_blocker_has_driver_copy', () => {
    for (const blocker of Object.keys(blockedConfirmationFixtures) as (keyof typeof blockedConfirmationFixtures)[]) {
      expect(blockerMessage(blocker)).not.toBe('')
    }
  })

  it('test_pending_identity_is_not_worded_as_a_check_in_progress', () => {
    expect(identityLabel('pending')).toMatch(/not yet verified/)
    expect(identityLabel('failed')).toMatch(/cannot complete/)
  })
})
