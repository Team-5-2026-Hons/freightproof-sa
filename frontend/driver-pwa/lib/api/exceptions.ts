// frontend/driver-pwa/lib/api/exceptions.ts
import { api } from './client'
import type { ExceptionType, TripException } from '@shared/lib/types/exception'

export interface RaiseExceptionBody {
  exception_type: ExceptionType
  description: string
  supporting_artifact_id?: string
}

export const raiseException = (tripId: string, body: RaiseExceptionBody): Promise<TripException> =>
  api.post<TripException>(`/api/v1/trips/${tripId}/exceptions`, body)
