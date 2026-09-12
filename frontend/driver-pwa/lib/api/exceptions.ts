// frontend/driver-pwa/lib/api/exceptions.ts
import { api } from './client'
import type { ExceptionType, TripException } from '@shared/lib/types/exception'
import type { VehicleType } from '@shared/lib/types/vehicle'

export interface RaiseExceptionBody {
  exception_type: ExceptionType
  description: string
  supporting_artifact_id?: string
  // The phase the driver was on when this happened, resolved from the trip plan at the
  // moment of the event (lib/phase/derive.ts contextPhaseEventId). Sent from the client
  // rather than derived server-side because an entry can sit in the offline queue for
  // hours — by flush time the trip has moved on, and the server would tag the wrong
  // phase. Omitted only when the plan is empty or fully resolved; the backend then
  // derives its own placement.
  phase_event_id?: string
  // Driver-phone GPS fix at the moment the exception was raised (panic page captures
  // this via useLocation). Backend enforces both-or-neither plus range (-90..90 /
  // -180..180) on DriverExceptionCreateBody, so never send one axis without the other.
  gps_lat?: number
  gps_lng?: number
  // Stable id for this exact report, not echoed back on the response. The offline
  // queue stamps its own entry UUID here at enqueue time and resends it unchanged on
  // every retry of that entry (lib/hooks/useOfflineQueue.ts enqueueException/
  // sendException) — so a resubmission caused by a lost response, or by a retry after
  // the photo uploaded but this POST itself failed, returns the SAME exception
  // instead of raising a second one for one real-world report. Omitted by the direct
  // (non-queued) online submit, which has no retry of its own to correlate.
  client_report_id?: string
  // The driver's answer to "Truck or Trailer?" on a vehicle breakdown. Only the kind is
  // sent: the server works out the exact vehicle from the trip's own horse and trailers,
  // so an entry flushed from the offline queue hours later still lands on the right
  // vehicle. Omitted for every other exception type.
  vehicle_type?: VehicleType
  // Sent only for a trailer breakdown on a trip with two or more trailers, where
  // "Trailer" alone can't say which one: the trailer whose plate the driver picked.
  trailer_id?: string
}

export const raiseException = (tripId: string, body: RaiseExceptionBody): Promise<TripException> =>
  api.post<TripException>(`/api/v1/trips/${tripId}/exceptions`, body)
