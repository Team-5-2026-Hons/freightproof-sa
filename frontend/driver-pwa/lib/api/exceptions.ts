// frontend/driver-pwa/lib/api/exceptions.ts
import { api } from './client'
import type { ExceptionType, TripException } from '@shared/lib/types/exception'

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
}

export const raiseException = (tripId: string, body: RaiseExceptionBody): Promise<TripException> =>
  api.post<TripException>(`/api/v1/trips/${tripId}/exceptions`, body)
