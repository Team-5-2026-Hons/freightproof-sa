// Exception display formatting.
//
// Module-scoped rather than page-local because two surfaces render the same exception:
// the trip timeline's standalone cards and the in-transit leg's own mini-timeline. When
// this transform lived in the page, the leg had no access to it and printed the raw
// enum — so one exception read two different ways depending on which phase it landed on.

import type { TripExceptionDetail } from '@shared/lib/types/exception'
import { NO_DATA } from './analytics'
import { VEHICLE_TYPE_LABELS } from './vehicle'

// A breakdown's Vehicle row when no vehicle was recorded: every breakdown reported before
// drivers were asked "truck or trailer". The analytics count those for the horse.
export const VEHICLE_NOT_RECORDED = 'Not recorded'

const EXCEPTION_TYPE_LABELS: Partial<Record<string, string>> = {
  driver_vehicle_separation: 'Driver–vehicle separation',
}

/** "waybill_count_mismatch" -> "Waybill Count Mismatch". */
export function fmtExceptionType(type: string): string {
  return EXCEPTION_TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
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
