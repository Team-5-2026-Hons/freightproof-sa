// Exception display formatting, module-scoped so both the trip timeline's cards and the
// in-transit leg's mini-timeline render the same exception the same way.

import type { TripExceptionDetail } from '@shared/lib/types/exception'
import { NO_DATA } from './analytics'
import { VEHICLE_TYPE_LABELS } from './vehicle'

export const VEHICLE_NOT_RECORDED = 'Not recorded'

/** "waybill_count_mismatch" -> "Waybill Count Mismatch"; "receiver_id_mismatch" ->
 *  "Receiver ID Mismatch" (an abbreviation reads wrong title-cased as "Id"). */
export function fmtExceptionType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bId\b/g, 'ID')
}

/** A breakdown's Vehicle row: "Trailer · TRL 222 GP". "Not recorded" when no vehicle was
 *  recorded. A dash when one was recorded but its vehicle row is gone, so the backend
 *  could name neither its kind nor its plate. */
export function fmtBreakdownVehicle(
  exception: Pick<TripExceptionDetail, 'vehicle_id' | 'vehicle_registration' | 'vehicle_type'>,
): string {
  if (exception.vehicle_id === null) return VEHICLE_NOT_RECORDED
  const parts = [
    exception.vehicle_type ? VEHICLE_TYPE_LABELS[exception.vehicle_type] : null,
    exception.vehicle_registration,
  ].filter((part): part is string => part !== null && part !== '')
  return parts.length > 0 ? parts.join(' · ') : NO_DATA
}
