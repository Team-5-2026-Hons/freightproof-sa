import { api } from './client'
import type { ExceptionType, TripException } from '@shared/lib/types/exception'
import type { VehicleType } from '@shared/lib/types/vehicle'

export interface RaiseExceptionBody {
  exception_type: ExceptionType
  description: string
  supporting_artifact_id?: string
  supporting_artifact_ids?: string[]
  phase_event_id?: string
  gps_lat?: number
  gps_lng?: number
  driver_captured_at?: string
  driver_accuracy_metres?: number
  client_report_id?: string
  vehicle_type?: VehicleType
  trailer_id?: string
  custody_sequence?: number
}

export const raiseException = (tripId: string, body: RaiseExceptionBody): Promise<TripException> =>
  api.post<TripException>(`/api/v1/trips/${tripId}/exceptions`, body)
