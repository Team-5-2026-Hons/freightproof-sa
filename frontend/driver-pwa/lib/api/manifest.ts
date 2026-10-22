import { api, ApiError } from './client'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import type { Linehaul } from '@shared/lib/types/manifest'

// Same GET /trips/{id}/manifest endpoint as the dispatcher — the backend shapes
// the response by caller role, so a driver token always gets Linehaul, never Manifest.
//
// Demo mode: IS_DEMO_MODE (NEXT_PUBLIC_DEMO_MODE=true/unset) returns a mock result
// immediately, so the Linehaul step in demo mode (the default) doesn't fire a real fetch
// at localhost:8000 that always fails.
// Returns null when the trip has no Linehaul document (backend 404s) — any trip created
// without a Parcel Perfect reference, which is common. That is a normal state, not a
// failure: the Linehaul step must let the driver proceed on their own visual count alone
// rather than treating it as a connection error and disabling the confirm button forever.
// Any other error (network, 5xx, etc.) still throws so the real error+retry UI fires.
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
