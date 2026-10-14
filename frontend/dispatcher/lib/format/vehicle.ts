// Single source of vehicle-kind display labels, shared across analytics, exceptions and
// the detail page. A Record, so a new vehicle type is a compile error, not a blank label.

import type { VehicleType } from '@shared/lib/types/vehicle'

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  horse: 'Horse',
  trailer: 'Trailer',
}
