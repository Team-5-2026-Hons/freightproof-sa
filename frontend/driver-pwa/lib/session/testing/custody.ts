import {
  bindActorLease,
  invalidateActorLease,
  setCustodyContext,
  type CustodyStamp,
} from '../custody-context'

/** Establish the authenticated account separately from the trip's custody answer. */
export function authenticateTestDriver(tripId: string, custodySequence = 0): CustodyStamp {
  const actorId = 'driver-1'
  bindActorLease(actorId, invalidateActorLease())
  setCustodyContext({ actorId, tripId, custodySequence })
  return { actorId, custodySequence }
}
