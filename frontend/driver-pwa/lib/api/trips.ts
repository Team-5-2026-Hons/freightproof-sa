// frontend/driver-pwa/lib/api/trips.ts
import { api } from './client'
import type { Trip } from '@shared/lib/types/trip'

// Mirror backend/app/schemas/handshakes.py H1CompleteRequest..H5CompleteRequest exactly —
// these are the wire bodies, distinct from the camelCase evidence drafts in
// lib/types/evidence-draft.ts which hold UI-side state (data URLs, not artifact IDs yet).
export interface H1CompleteRequest {
  driver_phone_lat: number
  driver_phone_lng: number
  gate_photo_artifact_id: string
}

export interface H2CompleteRequest {
  waybill_photo_artifact_id: string
  seal_number: string
  seal_photo_artifact_id: string
  driver_visual_count: number
}

export interface H3CompleteRequest {
  gate_exit_photo_artifact_id: string
  guard_verified_seal: boolean
}

export interface H4CompleteRequest {
  gate_entry_photo_artifact_id: string
  seal_number_at_destination: string
}

export interface H5CompleteRequest {
  // BQ2 resolved 2026-06-29: proof of delivery is a photo AND an on-device
  // signature — both required, not either/or.
  pod_photo_artifact_id: string
  pod_signature_artifact_id: string
  driver_visual_count: number
  pp_scan_in_count: number
}

export const fetchMyActiveTrip = (): Promise<Trip | null> => api.get<Trip | null>('/api/v1/trips/me/active')

export const completeH1 = (tripId: string, body: H1CompleteRequest): Promise<Trip> =>
  api.post<Trip>(`/api/v1/trips/${tripId}/handshakes/h1/complete`, body)

export const completeH2 = (tripId: string, body: H2CompleteRequest): Promise<Trip> =>
  api.post<Trip>(`/api/v1/trips/${tripId}/handshakes/h2/complete`, body)

export const completeH3 = (tripId: string, body: H3CompleteRequest): Promise<Trip> =>
  api.post<Trip>(`/api/v1/trips/${tripId}/handshakes/h3/complete`, body)

export const completeH4 = (tripId: string, body: H4CompleteRequest): Promise<Trip> =>
  api.post<Trip>(`/api/v1/trips/${tripId}/handshakes/h4/complete`, body)

export const completeH5 = (tripId: string, body: H5CompleteRequest): Promise<Trip> =>
  api.post<Trip>(`/api/v1/trips/${tripId}/handshakes/h5/complete`, body)
