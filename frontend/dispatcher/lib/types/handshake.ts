// Handshake: one of five sequential evidence-capture events that progress a trip
// through its lifecycle. Each handshake has its own status independent of the trip.
// Corresponds to backend HandshakeType/HandshakeStatus enums.

export type HandshakeEventId = string & { readonly __brand: 'HandshakeEventId' }

// 0 = trip creation (dispatcher), 1–5 = the five physical handshakes.
export type HandshakeNumber = 0 | 1 | 2 | 3 | 4 | 5

// Mirrors backend HandshakeType exactly.
export type HandshakeType =
  | 'trip_creation'
  | 'origin_gate_in'
  | 'loading'
  | 'origin_gate_out'
  | 'dest_gate_in'
  | 'unloading'

// Mirrors backend HandshakeStatus exactly — drives node visual state in HandshakeChain.
// pending → in_progress → completed (happy path); exception and overridden are off-path.
export type HandshakeStatus =
  | 'pending'      // Not yet started; rendered as an empty/dim node
  | 'in_progress'  // Currently active; rendered as a glowing node
  | 'completed'    // Fully evidenced; rendered with a tick
  | 'exception'    // Blocked by an unresolved exception; rendered as a warning node
  | 'overridden'   // Completed via dispatcher override; rendered with an override badge

export interface HandshakeStep {
  handshake: HandshakeNumber
  stepIndex: number
  slug: string
  displayName: string
}
