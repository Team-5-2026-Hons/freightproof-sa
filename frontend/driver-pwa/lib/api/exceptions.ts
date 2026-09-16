import { api } from './client'
import type { ExceptionType, TripException } from '@shared/lib/types/exception'
import type { VehicleType } from '@shared/lib/types/vehicle'

export interface RaiseExceptionBody {
  exception_type: ExceptionType
  description: string
  supporting_artifact_id?: string
  // Resolved from the trip plan at the moment of the event (lib/phase/derive.ts
  // contextPhaseEventId), sent by the client since an entry can sit queued for hours —
  // by flush time the trip has moved on. Omitted when the plan is empty/fully resolved.
  phase_event_id?: string
  // Driver-phone GPS fix at the moment raised. Backend enforces both-or-neither, so
  // never send one axis without the other.
  gps_lat?: number
  gps_lng?: number
  // Stable id for this exact report. The offline queue stamps its own entry UUID here
  // and resends it unchanged on every retry, so a resubmission returns the same
  // exception instead of raising a second one. Omitted by direct online submits.
  client_report_id?: string
  // The driver's "Truck or Trailer?" answer on a breakdown. Only the kind is sent — the
  // server works out the exact vehicle from the trip's own horse and trailers.
  vehicle_type?: VehicleType
  // Sent only for a trailer breakdown on a trip with two or more trailers.
  trailer_id?: string
}

export const raiseException = (tripId: string, body: RaiseExceptionBody): Promise<TripException> =>
  api.post<TripException>(`/api/v1/trips/${tripId}/exceptions`, body)
