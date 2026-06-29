// frontend/driver-pwa/lib/api/manifest.ts
import { api } from './client'
import type { Linehaul } from '@shared/lib/types/manifest'

// Same GET /trips/{id}/manifest endpoint as the dispatcher — the backend shapes
// the response by caller role, so a driver token always gets Linehaul, never Manifest.
export const fetchLinehaul = (tripId: string): Promise<Linehaul> =>
  api.get<Linehaul>(`/api/v1/trips/${tripId}/manifest`)
