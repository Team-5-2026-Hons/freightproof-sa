// Trip: the primary freight movement record, created by a dispatcher and progressed
// through five handshakes by driver, gate staff, and warehouse. Corresponds to
// backend TripStatus enum in backend/app/db/models/enums.py.

export type TripId = string & { readonly __brand: 'TripId' }

// Mirrors backend TripStatus exactly — 10 states, no simplification.
// The driver app routes to different screens depending on which of these is active.
export type TripStatus =
  | 'created'          // Dispatcher created the trip; driver not yet gate-in at origin
  | 'origin_gate_in'   // H1 in progress — guard is verifying at origin gate
  | 'loading'          // H2 in progress — warehouse is scanning parcels onto vehicle
  | 'origin_gate_out'  // H3 in progress — guard is sealing and releasing at origin gate
  | 'in_transit'       // Vehicle is on the road between origin and destination
  | 'dest_gate_in'     // H4 in progress — guard is verifying at destination gate
  | 'unloading'        // H5 in progress — warehouse is scanning parcels off vehicle
  | 'closed'           // All 5 handshakes completed successfully
  | 'cancelled'        // Trip was cancelled before completion
  | 'exception_hold'   // Trip is paused pending resolution of a critical exception

export interface TripSummary {
  id: TripId
  tripReference: string
  orderNumber: string
  status: TripStatus
  plannedDepartureAt: string
  createdAt: string
}
