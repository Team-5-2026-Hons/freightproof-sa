// FP-83: who is capturing evidence on this phone, and under which custody period of which
// trip. Read SYNCHRONOUSLY at the moment of capture and stored with the capture — never
// re-read at send time, because a capture replayed after a handover (or after A→B→A) must
// still say the period it was taken in (driver substitution contract v1, "Existing reads
// and writes": new live writes carry `custody_sequence` captured with the evidence).
//
// Module scope, not React state: the offline queue, the phase submitter and the API
// wrappers run outside the component tree, and every one of them must stamp the same value
// the screen was showing when the driver acted.

export interface CustodyStamp {
  /** The signed-in driver's account id. null only when nobody is signed in. */
  actorId: string | null
  /**
   * The custody period the server last reported for THIS trip. null when the server sent
   * none (a pre-FP-83 backend, or a trip this phone has not loaded) — the wire field is then
   * omitted, which the contract accepts only on a trip with no substitution.
   */
  custodySequence: number | null
}

interface CustodyContextState {
  actorId: string | null
  tripId: string | null
  custodySequence: number | null
}

let state: CustodyContextState = { actorId: null, tripId: null, custodySequence: null }

type ActorListener = (actorId: string | null) => void
const actorListeners = new Set<ActorListener>()

/**
 * Fed by TripContext whenever the signed-in driver or the server's trip answer changes.
 * Idempotent, so it is safe to call during render. A change of signed-in driver is announced
 * to listeners on a later tick, never synchronously: they update other components' state, and
 * doing that mid-render would be a React error.
 */
export function setCustodyContext(next: CustodyContextState): void {
  const actorChanged = next.actorId !== state.actorId
  state = next
  if (!actorChanged || actorListeners.size === 0) return
  const actorId = next.actorId
  setTimeout(() => actorListeners.forEach((listener) => listener(actorId)), 0)
}

/**
 * Called after the signed-in driver changes — so work captured by this driver, held while
 * nobody (or someone else) was signed in, is sent and recounted without waiting for the next
 * foreground. Returns an unsubscribe function.
 */
export function onCustodyActorChange(listener: ActorListener): () => void {
  actorListeners.add(listener)
  return () => actorListeners.delete(listener)
}

/**
 * The stamp for a capture on `tripId`, taken now. A sequence learned for a different trip is
 * never borrowed: that would label this capture with another trip's period.
 */
export function captureCustody(tripId: string): CustodyStamp {
  return {
    actorId: state.actorId,
    custodySequence: state.tripId === tripId ? state.custodySequence : null,
  }
}

/** Whoever is signed in right now — the only account whose queued work may be sent. */
export function currentActorId(): string | null {
  return state.actorId
}

export function __resetCustodyContextForTests(): void {
  state = { actorId: null, tripId: null, custodySequence: null }
}
