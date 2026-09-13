// Vehicle display formatting.
//
// The words the vehicle detail page has always shown for a vehicle's kind, kept in one
// place so the analytics Type column, an exception's Vehicle row and the detail page can
// never name the same vehicle two ways. A Record, so a new vehicle type is a compile error
// here rather than a blank label.

import type { VehicleType } from '@shared/lib/types/vehicle'

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  horse: 'Horse',
  trailer: 'Trailer',
}
