// Who is capturing evidence on this phone, and under which custody period of which
// trip. Read SYNCHRONOUSLY at the moment of capture and stored with the capture — never
// re-read at send time, because a capture replayed after a handover (or after A→B→A) must
// still say the period it was taken in (driver substitution contract v1, "Existing reads
// and writes": new live writes carry `custody_sequence` captured with the evidence).
//
// Module scope, not React state: the offline queue, the phase submitter and the API
// wrappers run outside the component tree, and every one of them must stamp the same value
// the screen was showing when the driver acted.

export interface CustodyStamp {
  actorId: string | null
  custodySequence: number | null
}

interface CustodyContextState {
  actorId: string | null
  tripId: string | null
  custodySequence: number | null
}

let state: CustodyContextState = { actorId: null, tripId: null, custodySequence: null }
let generation = 0
let authSubject: string | null = null

export interface ActorLease {
  actorId: string
  generation: number
}

export function actorGeneration(): number {
  return generation
}

export function assertActorGeneration(expectedGeneration: number): void {
  if (generation !== expectedGeneration) throw new Error('Account changed; captured work is retained.')
}

export function invalidateActorLease(): number {
  generation += 1
  state = { actorId: null, tripId: null, custodySequence: null }
  announceActor(null)
  return generation
}

export function observeAuthSession(subject: string | null): number {
  if (subject !== authSubject) {
    authSubject = subject
    invalidateActorLease()
  }
  return generation
}

export function bindActorLease(actorId: string, expectedGeneration: number): boolean {
  if (generation !== expectedGeneration) return false
  if (state.actorId !== actorId) {
    state = { actorId, tripId: null, custodySequence: null }
    announceActor(actorId)
  }
  return true
}

export function captureActorLease(): ActorLease | null {
  return state.actorId === null ? null : { actorId: state.actorId, generation }
}

export function isActorLeaseCurrent(lease: ActorLease): boolean {
  return lease.generation === generation && lease.actorId === state.actorId
}

export function assertActorLease(lease: ActorLease): void {
  if (!isActorLeaseCurrent(lease)) throw new Error('Account changed; captured work is retained.')
}

type ActorListener = (actorId: string | null) => void
const actorListeners = new Set<ActorListener>()

function announceActor(actorId: string | null): void {
  setTimeout(() => actorListeners.forEach((listener) => listener(actorId)), 0)
}

/**
 * Fed by TripContext whenever the signed-in driver or the server's trip answer changes.
 * Idempotent, so it is safe to call during render. A change of signed-in driver is announced
 * to listeners on a later tick, never synchronously: they update other components' state, and
 * doing that mid-render would be a React error.
 */
export function setCustodyContext(next: CustodyContextState): void {
  if (next.actorId !== state.actorId) return
  const changed = next.tripId !== state.tripId || next.custodySequence !== state.custodySequence
  state = next
  if (changed) setTimeout(() => tripCustodyListeners.forEach(listener => listener()), 0)
}

const tripCustodyListeners = new Set<() => void>()

/** Trip/period visibility changes, separate from account changes that trigger queue work. */
export function onTripCustodyChange(listener: () => void): () => void {
  tripCustodyListeners.add(listener)
  return () => { tripCustodyListeners.delete(listener) }
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

/** A visible scope must belong to the selected trip, not another trip's unknown period. */
export function isCurrentTripCustody(tripId: string, custody: CustodyStamp): boolean {
  return state.tripId === tripId && state.actorId === custody.actorId
    && (state.custodySequence ?? 0) === (custody.custodySequence ?? 0)
}

/** Whoever is signed in right now — the only account whose queued work may be sent. */
export function currentActorId(): string | null {
  return state.actorId
}

export function __resetCustodyContextForTests(): void {
  state = { actorId: null, tripId: null, custodySequence: null }
  generation += 1
  authSubject = null
}
