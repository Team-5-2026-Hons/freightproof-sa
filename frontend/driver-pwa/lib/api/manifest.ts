import { api, ApiError } from './client'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import type { Linehaul } from '@shared/lib/types/manifest'

export async function fetchLinehaul(tripId: string): Promise<Linehaul | null> {
  if (IS_DEMO_MODE) {
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    return {
      trip_id: tripId,
      vehicle_registration: 'GP 12-34 ZX',
      vehicle_type: 'Interlink',
      driver_full_name: 'Demo Driver',
      consolidated_unit_count: 27,
      origin_scan_complete: true,
      pulled_at: new Date().toISOString(),
    }
  }

  try {
    return await api.get<Linehaul>(`/api/v1/trips/${tripId}/manifest`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}
