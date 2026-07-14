// frontend/driver-pwa/lib/api/manifest.ts
import { api } from './client'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import type { Linehaul } from '@shared/lib/types/manifest'

// Same GET /trips/{id}/manifest endpoint as the dispatcher — the backend shapes
// the response by caller role, so a driver token always gets Linehaul, never Manifest.
//
// Demo mode: IS_DEMO_MODE (NEXT_PUBLIC_DEMO_MODE=true/unset) returns a mock result
// immediately, same short-circuit lib/api/handshakes.ts's submitHandshake uses.
// components/handshake/steps/H2Linehaul.tsx already calls this directly (with its own
// loading/error/retry states) — without this gate, opening H2's Confirm Linehaul step
// in demo mode (the default) fired a real fetch at localhost:8000 that always failed.
export async function fetchLinehaul(tripId: string): Promise<Linehaul> {
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

  return api.get<Linehaul>(`/api/v1/trips/${tripId}/manifest`)
}
